import { ApiProperty } from '@nestjs/swagger';

import { CampoId } from '../../common/mcp/campo-id.decorator';
import { ArquivoGeradoMcpDto } from '../../common/mcp/arquivo-gerado.dto';
import { AtualizarEditalDto } from './dto/atualizar-edital.dto';

export class EditalMcpDto {
  @CampoId('id', 'ID do edital.')
  id: string;
}

export class AtualizarEditalMcpDto extends AtualizarEditalDto {
  @CampoId('id', 'ID do edital a atualizar.')
  id: string;
}

export class InscricaoMcpDto {
  @CampoId('id', 'ID da candidatura.')
  id: string;
}

/** Resultado da exclusao logica: o edital continua existindo, apenas inativo. */
export class EditalExcluidoMcpDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: false, description: 'Sempre false: a exclusao e logica.' })
  ativo: boolean;

  @ApiProperty({
    example: 'Edital desativado. As candidaturas recebidas foram preservadas.',
  })
  mensagem: string;
}

/** Planilha de candidaturas gerada, com a contagem de linhas do recorte. */
export class PlanilhaDeInscricoesMcpDto extends ArquivoGeradoMcpDto {
  @ApiProperty({ example: 245, description: 'Quantas candidaturas entraram na planilha.' })
  totalDeInscricoes: number;
}
