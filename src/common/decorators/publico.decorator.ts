import { SetMetadata } from '@nestjs/common';

export const CHAVE_ROTA_PUBLICA = 'rota_publica';

/**
 * Libera a rota da autenticacao obrigatoria.
 *
 * O JwtAuthGuard e registrado GLOBALMENTE, entao o padrao do sistema e
 * "tudo exige token". Esquecer de proteger uma rota nao gera falha de seguranca;
 * no maximo gera um 401 indevido, que aparece no primeiro teste. O inverso
 * (proteger rota a rota) falha em silencio.
 */
export const Publico = () => SetMetadata(CHAVE_ROTA_PUBLICA, true);
