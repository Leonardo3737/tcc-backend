import { ApiProperty } from '@nestjs/swagger';

/**
 * Resposta das ferramentas MCP cujo equivalente REST devolve um arquivo.
 *
 * O relatorio em .docx, a planilha em .xlsx e o boletim em PDF sao binarios
 * OOXML e PDF. Devolve-los como base64 no resultado da ferramenta seria tecnica
 * e literalmente possivel, e errado por dois motivos:
 *
 *  1. um boletim pode ter ate 5 MB, que viram ~6,7 MB em base64 — tamanho que
 *     estoura o limite de qualquer cliente MCP e, quando nao estoura, e cortado
 *     no meio, produzindo um arquivo invalido que parece ter chegado inteiro;
 *  2. nenhum dos tres e legivel como texto, entao o conteudo nao ajuda em nada
 *     o cliente a responder — so ocupa espaco.
 *
 * A ferramenta entao GERA o arquivo de verdade (passando pela mesma autorizacao
 * e pelas mesmas regras do REST, inclusive a recusa acima do teto de linhas da
 * exportacao) e devolve o que descreve o resultado, com o caminho autenticado
 * para baixa-lo. O trabalho e feito; o que nao trafega e o binario.
 */
export class ArquivoGeradoMcpDto {
  @ApiProperty({ example: 'relatorio-monitoria-MAT101-2026-2.docx' })
  nomeDoArquivo: string;

  @ApiProperty({ example: 'application/pdf', description: 'Tipo de conteudo do arquivo.' })
  tipoDeConteudo: string;

  @ApiProperty({ example: 52690, description: 'Tamanho do arquivo gerado, em bytes.' })
  tamanhoBytes: number;

  @ApiProperty({
    example: '/api/monitorias/3f1c.../relatorio',
    description: 'Caminho da API para baixar o arquivo, com o mesmo token desta sessao.',
  })
  caminhoDeDownload: string;
}
