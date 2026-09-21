import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato unico de erro da API. Documentado no Swagger para que o frontend
 * possa tratar erros sem adivinhar o formato de cada rota.
 */
export class RespostaErro {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Conflict', description: 'Nome curto e estavel do tipo de erro.' })
  erro: string;

  @ApiProperty({
    example: 'Ja existe um usuario cadastrado com este e-mail.',
    description: 'Mensagem legivel, adequada para exibir ao usuario final.',
  })
  mensagem: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['email deve ser um endereco de e-mail valido'],
    description: 'Presente apenas em erros de validacao de entrada.',
  })
  detalhes?: string[];

  @ApiProperty({ example: '/api/auth/registro/aluno' })
  caminho: string;

  @ApiProperty({ example: '2026-08-20T12:00:00.000Z' })
  timestamp: string;
}
