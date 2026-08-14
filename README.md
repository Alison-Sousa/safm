# Sistema para análise automatizada de bases de dados financeiras e macroeconômicas

O SAFM ajuda estudantes, pesquisadores e analistas a transformar uma pergunta em uma base de dados pronta para trabalhar.

Você descreve o assunto, escolhe os indicadores e o período, e o próprio site organiza os dados oficiais. Depois, é possível explorar o resultado em gráficos, estimar modelos econométricos e baixar a base — sem precisar procurar arquivos em vários portais ou escrever código.


Repositório oficial: https://github.com/Alison-Sousa/safm

## Como usar

1. Abra o site e descreva o que deseja estudar.
   
   Exemplos:
   
   - `Selic, inflação e dólar desde 1995`
   - `ROE, endividamento e crescimento da receita das empresas`
   - `Exportações e importações brasileiras desde 1997`

2. Confira o tema reconhecido e selecione as variáveis que entrarão na pesquisa.

3. Escolha o período e como os dados ausentes devem ser tratados.

4. Clique em **Montar base**.

5. Explore o gráfico, veja uma amostra das linhas e, se fizer sentido para a pesquisa, estime o modelo diretamente na página.

6. Baixe o resultado em Excel, CSV ou Parquet.

Não é necessário criar conta ou enviar arquivos pessoais.

## O que está disponível

### Finanças das empresas

Dados anuais das demonstrações financeiras de companhias abertas, publicados pela CVM, de 2020 a 2025.

Indicadores disponíveis incluem ROE, ROA, endividamento, liquidez corrente, margem operacional, caixa, receita, ativo total, lucro líquido, patrimônio líquido e crescimento anual.

### Macroeconomia

Séries anuais oficiais do Banco Central do Brasil:

- Selic acumulada no ano;
- inflação medida pelo IPCA;
- cotação média do dólar comercial.

### Comércio exterior

Totais anuais oficiais do MDIC/Comex Stat desde 1997:

- exportações;
- importações;
- saldo comercial;
- corrente de comércio.

Somente áreas com montagem validada aparecem como disponíveis. O site não inventa valores nem apresenta como pronta uma fonte que ainda não foi conectada com segurança.

## Gráficos e modelagem

Depois que a base fica pronta, a página cria uma visualização interativa e permite estimar:

- regressão OLS;
- efeitos fixos de unidade e tempo;
- diferenças-em-diferenças;
- diferenças triplas.

O resultado mostra coeficientes, erros-padrão, p-valores e intervalos de confiança. Cada método também traz uma explicação curta para ajudar na escolha. Os scripts em R e Python são opcionais: a estimação principal já acontece dentro do site.

## Como abrir no computador

No VS Code:

1. abra esta pasta;
2. instale a extensão **Live Server**, caso ainda não tenha;
3. clique com o botão direito em `index.html`;
4. escolha **Open with Live Server**.

É importante abrir por um servidor local. Abrir o `index.html` diretamente como arquivo pode fazer o navegador bloquear o carregamento das bases.

Se uma versão antiga continuar aparecendo depois de uma atualização, recarregue a página com `Ctrl + Shift + R`.

## Publicação

O projeto é um site estático e pode ser publicado no Netlify. O arquivo `netlify.toml` já contém a configuração necessária.

As bases usadas no fluxo principal ficam na pasta `data/`. Por isso, a montagem funciona tanto no Live Server quanto na versão publicada, sem depender de uma consulta externa demorada a cada clique.

## Atualização das fontes

O arquivo `tools/build_offline_snapshots.py` atualiza os recortes do Banco Central e da CVM diretamente nas fontes oficiais. Os arquivos de comércio exterior vêm das tabelas de conferência do MDIC.

Para atualizar Banco Central e CVM:

```bash
py tools/build_offline_snapshots.py
```

Também é possível atualizar apenas uma fonte:

```bash
py tools/build_offline_snapshots.py bcb
py tools/build_offline_snapshots.py cvm
```

## Verificação

```bash
npm test
```

Os testes verificam reconhecimento dos temas, montagem dos três tipos de base, cobertura das variáveis, gráficos e os quatro métodos econométricos.
