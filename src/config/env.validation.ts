import * as Joi from 'joi';

/**
 * Schema de validacao das variaveis de ambiente.
 *
 * A aplicacao falha ao subir se algo estiver ausente ou invalido. E preferivel
 * quebrar no boot, de forma explicita, a descobrir em producao que JWT_SECRET
 * estava vazio e todo token era assinado com string vazia.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_LOGGING: Joi.boolean().default(false),

  // 32 caracteres e o minimo defensavel para HS256.
  JWT_SECRET: Joi.string().min(32).required(),
  /**
   * D-09 decidida: 8h cobre uma jornada de trabalho e uma apresentacao inteira.
   *
   * Nao ha refresh token. O custo de um token viver mais e atenuado pela
   * JwtStrategy, que recarrega o usuario do banco a cada requisicao — desativar
   * uma conta tem efeito imediato, independentemente do TTL. Rotacao de refresh
   * fica registrada como o caminho de producao (ver README).
   */
  JWT_EXPIRES_IN: Joi.string().default('8h'),

  EMAIL_DOMINIOS_PERMITIDOS: Joi.string().allow('').default(''),
  CODIGO_CADASTRO_PROFESSOR: Joi.string().allow('').default(''),

  // Fuso usado para casar um atendimento (TIMESTAMPTZ) com a disponibilidade
  // semanal do monitor, que e declarada em horario local.
  TIMEZONE_INSTITUICAO: Joi.string().default('America/Sao_Paulo'),

  /**
   * D-15 — limites de agendamento, agora configuraveis por instituicao.
   *
   * Os defaults de antecedencia sao ZERO de proposito: preservam exatamente o
   * comportamento anterior (qualquer horario futuro serve; o aluno pode desistir
   * ate o instante do inicio). O mecanismo passa a existir e cada instituicao
   * decide se quer aperta-lo — em vez de a regra ficar embutida em constante.
   */
  AGENDAMENTO_DURACAO_MINIMA_MINUTOS: Joi.number().integer().min(5).max(600).default(15),
  AGENDAMENTO_DURACAO_MAXIMA_MINUTOS: Joi.number().integer().min(15).max(1440).default(240),
  AGENDAMENTO_ANTECEDENCIA_MINIMA_MINUTOS: Joi.number().integer().min(0).max(10080).default(0),
  CANCELAMENTO_ANTECEDENCIA_MINIMA_MINUTOS: Joi.number().integer().min(0).max(10080).default(0),
});
