import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import { TipoMaterial } from '../../common/enums/tipo-material.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { ContextoParticipacao } from '../monitorias/participacao.service';
import { Usuario } from '../usuarios/entities/usuario.model';
import { AtualizarMaterialDto } from './dto/atualizar-material.dto';
import { CriarMaterialDto } from './dto/criar-material.dto';
import { MaterialRespostaDto } from './dto/material-resposta.dto';
import { Material } from './entities/material.model';

@Injectable()
export class MateriaisService {
  constructor(@InjectModel(Material) private readonly materialModel: typeof Material) {}

  /**
   * RN08 — publicam o professor responsavel e os MONITORES habilitados.
   *
   * O MONITORADO e barrado: ele consome o acervo, nao o alimenta. A verificacao
   * de papel ja vem resolvida pelo ParticipacaoGuard; aqui so resta a regra que o
   * guard nao sabe expressar — nao publicar em monitoria encerrada.
   */
  async publicar(
    contexto: ContextoParticipacao,
    dto: CriarMaterialDto,
    usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    const { monitoria } = contexto;

    if (
      monitoria.status === StatusMonitoria.ENCERRADA ||
      monitoria.status === StatusMonitoria.CANCELADA
    ) {
      throw new ConflictException(
        `Monitoria ${monitoria.status.toLowerCase()} nao aceita novos materiais.`,
      );
    }

    const material = await this.materialModel.create({
      monitoriaId: monitoria.id,
      autorUsuarioId: usuario.id,
      titulo: dto.titulo,
      descricao: dto.descricao ?? null,
      tipo: TipoMaterial.LINK,
      url: dto.url,
    });

    return this.detalharPorId(material.id);
  }

  /**
   * RN07 — o acervo so aparece para quem participa.
   *
   * O acesso ja foi verificado pelo ParticipacaoGuard antes de chegar aqui. Nao
   * existe rota publica de materiais: nem por monitoria, nem por disciplina.
   */
  async listar(
    monitoriaId: string,
    paginacao: PaginacaoDto,
    incluirRemovidos: boolean,
  ): Promise<RespostaPaginada<MaterialRespostaDto>> {
    const where: Record<string, unknown> = { monitoriaId };

    if (!incluirRemovidos) {
      where.removidoEm = null;
    }

    const { rows, count } = await this.materialModel.findAndCountAll({
      where,
      include: [{ model: Usuario, as: 'autor', attributes: ['id', 'nome'] }],
      order: [['created_at', 'DESC']],
      limit: paginacao.limite,
      offset: paginacao.offset,
      distinct: true,
    });

    return new RespostaPaginada(
      rows.map(MaterialRespostaDto.deModelo),
      count,
      paginacao.pagina,
      paginacao.limite,
    );
  }

  async detalhar(monitoriaId: string, materialId: string): Promise<MaterialRespostaDto> {
    const material = await this.buscarOuFalhar(materialId, monitoriaId);
    return MaterialRespostaDto.deModelo(material);
  }

  /**
   * Editar e remover exigem ser o AUTOR ou o professor responsavel.
   *
   * Um monitor nao pode alterar o material publicado por outro monitor: ambos
   * teriam papel MONITOR e passariam por um guard que so olha o papel. Esta e a
   * camada de propriedade, que o guard nao alcanca.
   */
  async atualizar(
    contexto: ContextoParticipacao,
    materialId: string,
    dto: AtualizarMaterialDto,
    usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    const material = await this.buscarOuFalhar(materialId, contexto.monitoria.id);
    this.exigirAutoriaOuResponsavel(material, contexto, usuario);

    if (material.removidoEm) {
      throw new ConflictException('Material removido nao pode ser editado.');
    }

    await material.update({
      ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
      ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
      ...(dto.url !== undefined ? { url: dto.url } : {}),
    });

    return this.detalharPorId(material.id);
  }

  /** Soft delete: some das listagens, mas continua no banco (RN10). */
  async remover(
    contexto: ContextoParticipacao,
    materialId: string,
    usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    const material = await this.buscarOuFalhar(materialId, contexto.monitoria.id);
    this.exigirAutoriaOuResponsavel(material, contexto, usuario);

    if (material.removidoEm) {
      throw new ConflictException('Este material ja foi removido.');
    }

    await material.update({ removidoEm: new Date(), removidoPorUsuarioId: usuario.id });

    return this.detalharPorId(material.id);
  }

  private exigirAutoriaOuResponsavel(
    material: Material,
    contexto: ContextoParticipacao,
    usuario: UsuarioAutenticado,
  ): void {
    if (contexto.ehProfessorResponsavel || material.autorUsuarioId === usuario.id) {
      return;
    }

    throw new ForbiddenException(
      'Somente o autor do material ou o professor responsavel podem altera-lo.',
    );
  }

  private async buscarOuFalhar(materialId: string, monitoriaId: string): Promise<Material> {
    const material = await this.materialModel.findByPk(materialId, {
      include: [{ model: Usuario, as: 'autor', attributes: ['id', 'nome'] }],
    });

    // Checar a monitoria evita que um material de outra monitoria seja lido por
    // quem tem acesso a esta — o id sozinho nao autoriza nada.
    if (!material || material.monitoriaId !== monitoriaId) {
      throw new NotFoundException('Material nao encontrado nesta monitoria.');
    }

    return material;
  }

  private async detalharPorId(materialId: string): Promise<MaterialRespostaDto> {
    const material = await this.materialModel.findByPk(materialId, {
      include: [{ model: Usuario, as: 'autor', attributes: ['id', 'nome'] }],
    });

    return MaterialRespostaDto.deModelo(material!);
  }

  /** Usado pelo Analytics. */
  contarPorMonitoria(monitoriaId: string): Promise<number> {
    return this.materialModel.count({ where: { monitoriaId, removidoEm: null } });
  }
}
