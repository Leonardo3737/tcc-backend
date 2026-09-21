import { SetMetadata } from '@nestjs/common';

import { PapelMonitoria } from '../enums/papel-monitoria.enum';

export const CHAVE_PARTICIPACAO = 'requisito_participacao';

export interface RequisitoParticipacao {
  /** Papeis aceitos. Ausente = qualquer participante ativo. */
  papeis?: PapelMonitoria[];
  /**
   * Como tratar o professor responsavel pela monitoria:
   *  - PERMITIDO (padrao): passa mesmo sem papel de participante;
   *  - EXIGIDO: somente ele passa;
   *  - NEGADO: nao passa. Usado em acoes que so fazem sentido para o aluno
   *    (declarar disponibilidade de monitor, por exemplo) — o professor
   *    administra a monitoria, mas nao TEM agenda de monitor.
   */
  professorResponsavel?: 'PERMITIDO' | 'EXIGIDO' | 'NEGADO';
}

/**
 * Autorizacao CONTEXTUAL: depende do papel do usuario dentro da monitoria da
 * rota, e nao do seu perfil global. Exige um parametro `monitoriaId` na rota.
 */
export const ExigeParticipacao = (requisito: RequisitoParticipacao = {}) =>
  SetMetadata(CHAVE_PARTICIPACAO, requisito);
