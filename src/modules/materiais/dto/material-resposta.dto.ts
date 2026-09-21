import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TipoMaterial } from '../../../common/enums/tipo-material.enum';
import { Material } from '../entities/material.model';

export class MaterialRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) monitoriaId: string;
  @ApiProperty({ example: 'Lista de exercicios - Limites' }) titulo: string;
  @ApiPropertyOptional({ nullable: true }) descricao: string | null;
  @ApiProperty({ enum: TipoMaterial }) tipo: TipoMaterial;
  @ApiPropertyOptional({ nullable: true }) url: string | null;
  @ApiProperty({ format: 'uuid' }) autorUsuarioId: string;
  @ApiPropertyOptional({ example: 'Ana Martins' }) autorNome?: string;
  @ApiProperty() publicadoEm: Date;
  @ApiPropertyOptional({ nullable: true, description: 'Preenchido quando removido (RN10).' })
  removidoEm: Date | null;

  static deModelo(material: Material): MaterialRespostaDto {
    const dto = new MaterialRespostaDto();
    dto.id = material.id;
    dto.monitoriaId = material.monitoriaId;
    dto.titulo = material.titulo;
    dto.descricao = material.descricao;
    dto.tipo = material.tipo;
    dto.url = material.url;
    dto.autorUsuarioId = material.autorUsuarioId;
    dto.autorNome = material.autor?.nome;
    dto.publicadoEm = material.createdAt;
    dto.removidoEm = material.removidoEm;
    return dto;
  }
}
