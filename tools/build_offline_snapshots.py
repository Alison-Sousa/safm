"""Atualiza os recortes oficiais usados pelo site estático.

Fontes: SGS/BCB e demonstrações financeiras padronizadas (DFP/CVM).
O arquivo gerado é um recorte, não uma base simulada. Execute uma vez por ano.
"""

from __future__ import annotations

import csv
import io
import math
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
USER_AGENT = "RotaDados-Brasil/1.0 (dados oficiais para pesquisa)"


def download(url: str, timeout: int = 120) -> bytes:
    last_error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    raise last_error


def download_cached(url: str, filename: str, timeout: int = 300) -> bytes:
    cache = Path(tempfile.gettempdir()) / "rotadados-official-cache"
    cache.mkdir(exist_ok=True)
    target = cache / filename
    if target.exists() and target.stat().st_size > 100_000:
        return target.read_bytes()
    partial = target.with_suffix(target.suffix + ".part")
    command = [
        "curl.exe", "-fL", "--retry", "5", "--retry-all-errors", "--retry-delay", "2",
        "--connect-timeout", "30", "--max-time", str(timeout), "-o", str(partial), url,
    ]
    subprocess.run(command, check=True)
    partial.replace(target)
    return target.read_bytes()


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower().strip()


def number(value: object) -> float | None:
    text = str(value or "").strip()
    if not text or text in {"-", "..", "...", "X", "x"}:
        return None
    try:
        if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text):
            return float(text)
        return float(text.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def annual_bcb(series: int, start: int, mode: str) -> dict[int, float]:
    values: dict[int, list[float]] = defaultdict(list)
    current = date.today().year
    # O SGS pode truncar silenciosamente séries diárias em janelas próximas de dez anos.
    # Blocos de cinco anos preservam toda a cobertura, inclusive para o câmbio diário.
    for first in range(start, current + 1, 5):
        last = min(current, first + 4)
        url = (
            f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series}/dados"
            f"?formato=csv&dataInicial=01/01/{first}&dataFinal=31/12/{last}"
        )
        text = download(url).decode("utf-8-sig")
        for row in csv.DictReader(io.StringIO(text), delimiter=";"):
            value = number(row.get("valor"))
            try:
                year = datetime.strptime(row.get("data", ""), "%d/%m/%Y").year
            except ValueError:
                continue
            if value is not None:
                values[year].append(value)
    result = {}
    for year, items in values.items():
        if mode == "compound":
            result[year] = (math.prod(1 + item / 100 for item in items) - 1) * 100
        else:
            result[year] = sum(items) / len(items)
    return result


def write_bcb() -> None:
    series = {
        "selic": annual_bcb(4390, 1986, "compound"),
        "ipca": annual_bcb(433, 1980, "compound"),
        "usd_brl": annual_bcb(1, 1984, "mean"),
    }
    years = sorted(set().union(*(values.keys() for values in series.values())))
    with (DATA / "bcb_annual.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\n")
        writer.writerow(["period", *series])
        for year in years:
            writer.writerow([year, *(format_number(series[name].get(year)) for name in series)])


ACCOUNTS = {
    "revenue": {"3.01"},
    "ebit": {"3.05"},
    "net_income": {"3.09", "3.11"},
    "assets": {"1"},
    "equity": {"2.03"},
    "current_assets": {"1.01"},
    "current_liabilities": {"2.01"},
    "noncurrent_liabilities": {"2.02"},
    "cash": {"1.01.01"},
}
STATEMENTS = {
    "DRE": {"revenue", "ebit", "net_income"},
    "BPA": {"assets", "current_assets", "cash"},
    "BPP": {"equity", "current_liabilities", "noncurrent_liabilities"},
}


def format_number(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return ""
    return f"{value:.12g}"


def ratio(a: float | None, b: float | None, multiplier: float = 1) -> float | None:
    if a is None or b is None or abs(b) <= 1e-12:
        return None
    return a / b * multiplier


def cvm_rows(year: int) -> dict[tuple[str, int], dict]:
    url = f"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{year}.zip"
    archive = zipfile.ZipFile(io.BytesIO(download_cached(url, f"dfp_cia_aberta_{year}.zip")))
    names = archive.namelist()
    companies: dict[tuple[str, int], dict] = {}
    for statement, wanted in STATEMENTS.items():
        for kind, rank in (("ind", 1), ("con", 2)):
            pattern = re.compile(rf"{statement}_{kind}_{year}\.csv$", re.I)
            name = next((item for item in names if pattern.search(item)), None)
            if not name:
                continue
            text = archive.read(name).decode("cp1252")
            for row in csv.DictReader(io.StringIO(text), delimiter=";"):
                if normalized(row.get("ORDEM_EXERC")) not in {"", "ultimo"}:
                    continue
                code = str(row.get("CD_CONTA") or "").strip()
                raw = next((key for key in wanted if code in ACCOUNTS[key]), None)
                if raw is None:
                    continue
                value = number(row.get("VL_CONTA"))
                cd_cvm = str(row.get("CD_CVM") or "").strip()
                if value is None or not cd_cvm:
                    continue
                if "mil" in normalized(row.get("ESCALA_MOEDA")):
                    value *= 1000
                reference = str(row.get("DT_REFER") or "")
                row_year = int(reference[:4]) if re.match(r"^\d{4}", reference) else year
                key = (cd_cvm, row_year)
                target = companies.setdefault(key, {
                    "cd_cvm": cd_cvm,
                    "cnpj": str(row.get("CNPJ_CIA") or "").strip(),
                    "empresa": str(row.get("DENOM_CIA") or "").strip(),
                    "ano": row_year,
                    "raw": {},
                    "meta": {},
                })
                version = int(number(row.get("VERSAO")) or 0)
                old = target["meta"].get(raw)
                if old is None or rank > old[0] or (rank == old[0] and version >= old[1]):
                    target["raw"][raw] = value
                    target["meta"][raw] = (rank, version)
                    target["empresa"] = str(row.get("DENOM_CIA") or target["empresa"]).strip()
                    target["cnpj"] = str(row.get("CNPJ_CIA") or target["cnpj"]).strip()
    return companies


def write_cvm(first_year: int = 2020) -> None:
    last_year = date.today().year - 1
    companies: dict[str, list[dict]] = defaultdict(list)
    for year in range(first_year, last_year + 1):
        print(f"CVM {year}...", flush=True)
        for row in cvm_rows(year).values():
            companies[row["cd_cvm"]].append(row)
    columns = [
        "cd_cvm", "cnpj", "empresa", "ano", "roe", "roa", "endividamento",
        "liquidez_corrente", "margem_operacional", "caixa", "crescimento_receita",
        "crescimento_ativos", "receita", "ativo_total", "lucro_liquido", "patrimonio_liquido",
    ]
    with (DATA / "cvm_finance.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, columns, delimiter=";", lineterminator="\n")
        writer.writeheader()
        for rows in companies.values():
            rows.sort(key=lambda item: item["ano"])
            for index, item in enumerate(rows):
                raw = item["raw"]
                previous = rows[index - 1] if index else None
                previous_raw = previous["raw"] if previous and item["ano"] - previous["ano"] == 1 else {}
                current_liabilities = raw.get("current_liabilities")
                noncurrent_liabilities = raw.get("noncurrent_liabilities")
                debt = None if current_liabilities is None and noncurrent_liabilities is None else (current_liabilities or 0) + (noncurrent_liabilities or 0)
                output = {
                    "cd_cvm": item["cd_cvm"], "cnpj": item["cnpj"], "empresa": item["empresa"], "ano": item["ano"],
                    "roe": ratio(raw.get("net_income"), raw.get("equity"), 100),
                    "roa": ratio(raw.get("net_income"), raw.get("assets"), 100),
                    "endividamento": ratio(debt, raw.get("assets"), 100),
                    "liquidez_corrente": ratio(raw.get("current_assets"), raw.get("current_liabilities")),
                    "margem_operacional": ratio(raw.get("ebit"), raw.get("revenue"), 100),
                    "caixa": raw.get("cash"),
                    "crescimento_receita": ratio((raw.get("revenue") - previous_raw["revenue"]) if raw.get("revenue") is not None and previous_raw.get("revenue") is not None else None, previous_raw.get("revenue"), 100),
                    "crescimento_ativos": ratio((raw.get("assets") - previous_raw["assets"]) if raw.get("assets") is not None and previous_raw.get("assets") is not None else None, previous_raw.get("assets"), 100),
                    "receita": raw.get("revenue"), "ativo_total": raw.get("assets"),
                    "lucro_liquido": raw.get("net_income"), "patrimonio_liquido": raw.get("equity"),
                }
                writer.writerow({key: output[key] if key in {"cd_cvm", "cnpj", "empresa", "ano"} else format_number(output[key]) for key in columns})


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    selected = set(sys.argv[1:]) or {"bcb", "cvm"}
    if "bcb" in selected:
        print("BCB...", flush=True)
        write_bcb()
    if "cvm" in selected:
        write_cvm()
    print("Snapshots oficiais atualizados.")
