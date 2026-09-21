import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { AtualizarDisciplinaDto } from './dto/atualizar-disciplina.dto';
import { CriarDisciplinaDto } from './dto/criar-disciplina.dto';
import { DisciplinaRespostaDto } from './dto/disciplina-resposta.dto';
import { FiltroDisciplinasDto } from './dto/filtro-disciplinas.dto';
import { Disciplina } from './entities/disciplina.model';

@Injectable()
export class DisciplinasService {
  constructor(@InjectModel(Disciplina) private readonly disciplinaModel: typeof Disciplina) {}

  async criar(dto: CriarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    // Codigo duplicado e barrado pela constraint UNIQUE; o filtro global
    // traduz a violacao em 409 com mensagem de dominio.
    const disciplina = await this.disciplinaModel.create({ codigo: dto.codigo, nome: dto.nome });
    return DisciplinaRespostaDto.deModelo(disciplina);
  }

  async listar(filtro: FiltroDisciplinasDto): Promise<RespostaPaginada<DisciplinaRespostaDto>> {
    const where: Record<string, unknown> = {};

    if (filtro.ativa !== undefined) {
      where.ativa = filtro.ativa;
    }

    if (filtro.busca) {
      where[Op.or as unknown as string] = [
        { codigo: { [Op.iLike]: `%${filtro.busca}%` } },
        { nome: { [Op.iLike]: `%${filtro.busca}%` } },
      ];
    }

    const { rows, count } = await this.disciplinaModel.findAndCountAll({
      where,
      order: [['nome', 'ASC']],
      limit: filtro.limite,
      offset: filtro.offset,
    });

    return new RespostaPaginada(
      rows.map(DisciplinaRespostaDto.deModelo),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  async buscarOuFalhar(id: string): Promise<Disciplina> {
    const disciplina = await this.disciplinaModel.findByPk(id);

    if (!disciplina) {
      throw new NotFoundException('Disciplina nao encontrada.');
    }

    return disciplina;
  }

  async detalhar(id: string): Promise<DisciplinaRespostaDto> {
    return DisciplinaRespostaDto.deModelo(await this.buscarOuFalhar(id));
  }

  async atualizar(id: string, dto: AtualizarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    const disciplina = await this.buscarOuFalhar(id);

    // Desativar nao apaga: monitorias passadas continuam apontando para ela (RN10).
    await disciplina.update({
      ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
      ...(dto.ativa !== undefined ? { ativa: dto.ativa } : {}),
    });

    return DisciplinaRespostaDto.deModelo(disciplina);
  }
}
