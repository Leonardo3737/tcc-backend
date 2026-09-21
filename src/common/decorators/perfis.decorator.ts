import { SetMetadata } from '@nestjs/common';

import { PerfilUsuario } from '../enums/perfil-usuario.enum';

export const CHAVE_PERFIS = 'perfis_exigidos';

/**
 * Exige um dos perfis de IDENTIDADE informados.
 *
 * Serve para autorizacao grosseira (ex.: so PROFESSOR lista alunos).
 * A autorizacao FINA por participacao em monitoria — que e o eixo real das
 * regras RN04/RN05/RN07/RN08 — sera um guard separado na fase 2, porque depende
 * do contexto da monitoria e nao do perfil global. Ver secao 9.2 da arquitetura.
 */
export const Perfis = (...perfis: PerfilUsuario[]) => SetMetadata(CHAVE_PERFIS, perfis);
