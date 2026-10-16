import { ApiProperty } from '@nestjs/swagger';

import { Edital } from '../entities/edital.model';

/**
 * Esta comparacao e de STRINGS, e isso e proposital.
 *
 * `inicioInscricoes` e `fimInscricoes` chegam do PostgreSQL como 'AAAA-MM-DD',
 * e `hoje` e calculado pelo proprio banco no fuso da instituicao. Nesse formato
 * a ordem lexicografica e a ordem cronologica, entao a comparacao direta e
 * exata — e, principalmente, nao reintroduz o fuso do processo Node, que e o
 * que aconteceria ao converter os tres para `Date`.
 */
export function estaNoPeriodo(edital: Edital, hoje: string): boolean {
  return hoje >= edital.inicioInscricoes && hoje <= edital.fimInscricoes;
}

/**
 * Edital visto pelo PROFESSOR.
 *
 * Expoe `ativo` e os timestamps, que a visao publica nao tem: para a banca
 * importa distinguir um edital excluido logicamente de um que nunca existiu.
 */
export class EditalRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date', example: '2026-11-10' }) inicioInscricoes: string;
  @ApiProperty({ format: 'date', example: '2026-11-25' }) fimInscricoes: string;
  @ApiProperty({ example: 'https://ufx.edu.br/editais/2026-2-monitoria.pdf' }) link: string;
  @ApiProperty({ example: 2026 }) ano: number;
  @ApiProperty({ example: 2 }) semestre: number;

  @ApiProperty({
    example: true,
    description: 'false = excluido logicamente (DELETE /editais/:id). Nao aceita inscricao.',
  })
  ativo: boolean;

  /**
   * Campo DERIVADO: hoje esta dentro do periodo E o edital esta ativo.
   *
   * Existe para o cliente nao repetir a conta — e repetir a conta no frontend
   * significa fazer no fuso do navegador o que o backend faz no fuso da
   * instituicao, produzindo um botao habilitado em um dia em que a API recusa.
   */
  @ApiProperty({
    example: true,
    description: 'Aceita inscricao agora: ativo e com a data de hoje dentro do periodo.',
  })
  aceitandoInscricoes: boolean;

  @ApiProperty({ example: '2026-10-16T12:00:00.000Z' }) criadoEm: Date;

  static deModelo(edital: Edital, hoje: string): EditalRespostaDto {
    const dto = new EditalRespostaDto();
    dto.id = edital.id;
    dto.inicioInscricoes = edital.inicioInscricoes;
    dto.fimInscricoes = edital.fimInscricoes;
    dto.link = edital.link;
    dto.ano = edital.ano;
    dto.semestre = edital.semestre;
    dto.ativo = edital.ativo;
    dto.aceitandoInscricoes = edital.ativo && estaNoPeriodo(edital, hoje);
    dto.criadoEm = edital.createdAt;
    return dto;
  }
}

/**
 * Edital visto por QUALQUER UM, sem autenticacao (`GET /editais/abertos`).
 *
 * Deliberadamente menor que a visao do professor. Sai `ativo` — a rota so
 * devolve editais ativos, entao o campo seria constante, e expo-lo convidaria o
 * cliente a confiar nele em vez do filtro do servidor. Saem os timestamps, que
 * nao servem a quem vai se inscrever. E sai `aceitandoInscricoes` pelo mesmo
 * motivo de `ativo`: todo item desta lista esta aceitando.
 */
export class EditalPublicoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date', example: '2026-11-10' }) inicioInscricoes: string;
  @ApiProperty({ format: 'date', example: '2026-11-25' }) fimInscricoes: string;
  @ApiProperty({ example: 'https://ufx.edu.br/editais/2026-2-monitoria.pdf' }) link: string;
  @ApiProperty({ example: 2026 }) ano: number;
  @ApiProperty({ example: 2 }) semestre: number;

  static deModelo(edital: Edital): EditalPublicoDto {
    const dto = new EditalPublicoDto();
    dto.id = edital.id;
    dto.inicioInscricoes = edital.inicioInscricoes;
    dto.fimInscricoes = edital.fimInscricoes;
    dto.link = edital.link;
    dto.ano = edital.ano;
    dto.semestre = edital.semestre;
    return dto;
  }
}
