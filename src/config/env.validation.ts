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

  /**
   * Base dos links enviados por e-mail. Validada como URI para que um valor
   * malformado quebre no boot, e nao na caixa de entrada de alguem.
   */
  URL_FRONT: Joi.string().uri().default('http://localhost:3001'),
  URL_PUBLICA: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),

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

  /**
   * E-mail transacional (Brevo). Todas opcionais: vazio = servico em modo log.
   *
   * EMAIL_REMETENTE_EMAIL passa por validacao de formato mesmo sendo opcional —
   * um remetente malformado so se revelaria no primeiro envio, que e tarde.
   */
  BREVO_API_KEY: Joi.string().allow('').default(''),
  EMAIL_REMETENTE_NOME: Joi.string().default('Plataforma de Monitoria'),
  EMAIL_REMETENTE_EMAIL: Joi.string().email().allow('').default(''),

  /**
   * Avisos por e-mail. Padrao FALSE: ver a justificativa em configuration.ts.
   */
  NOTIFICACOES_HABILITADAS: Joi.boolean().default(false),

  /** Trilha de requisicoes. Padrao TRUE: ver a justificativa em configuration.ts. */
  LOGS_REQUISICAO_HABILITADOS: Joi.boolean().default(true),

  // Fuso usado para casar um atendimento (TIMESTAMPTZ) com a disponibilidade
  // semanal do monitor, que e declarada em horario local.
  TIMEZONE_INSTITUICAO: Joi.string().default('America/Porto_Velho'),

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

  /**
   * B1 — duracao sugerida. Precisa caber ENTRE as outras duas, e isso e
   * verificado no boot: um padrao fora da faixa faria o cliente propor um
   * horario que o proprio servidor recusaria em seguida, sem explicacao obvia.
   */
  AGENDAMENTO_DURACAO_PADRAO_MINUTOS: Joi.number()
    .integer()
    .min(5)
    .max(1440)
    .default(60)
    .min(Joi.ref('AGENDAMENTO_DURACAO_MINIMA_MINUTOS'))
    .max(Joi.ref('AGENDAMENTO_DURACAO_MAXIMA_MINUTOS'))
    .messages({
      'number.min':
        'AGENDAMENTO_DURACAO_PADRAO_MINUTOS nao pode ser menor que AGENDAMENTO_DURACAO_MINIMA_MINUTOS.',
      'number.max':
        'AGENDAMENTO_DURACAO_PADRAO_MINUTOS nao pode ser maior que AGENDAMENTO_DURACAO_MAXIMA_MINUTOS.',
    }),
  AGENDAMENTO_ANTECEDENCIA_MINIMA_MINUTOS: Joi.number().integer().min(0).max(10080).default(0),
  CANCELAMENTO_ANTECEDENCIA_MINIMA_MINUTOS: Joi.number().integer().min(0).max(10080).default(0),
});
