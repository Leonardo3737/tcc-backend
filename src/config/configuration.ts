/**
 * Traduz variaveis de ambiente (strings) em um objeto de configuracao tipado.
 * Os services consomem isto via ConfigService, nunca process.env direto.
 */
export const configuration = () => ({
  app: {
    ambiente: process.env.NODE_ENV ?? 'development',
    porta: Number(process.env.PORT ?? 3000),
    prefixo: process.env.API_PREFIX ?? 'api',
    corsOrigens: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origem) => origem.trim())
      .filter(Boolean),
  },
  database: {
    host: process.env.DB_HOST as string,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME as string,
    username: process.env.DB_USER as string,
    password: process.env.DB_PASSWORD as string,
    logging: process.env.DB_LOGGING === 'true',
  },
  jwt: {
    segredo: process.env.JWT_SECRET as string,
    expiraEm: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  cadastro: {
    dominiosPermitidos: (process.env.EMAIL_DOMINIOS_PERMITIDOS ?? '')
      .split(',')
      .map((dominio) => dominio.trim().toLowerCase())
      .filter(Boolean),
    codigoProfessor: process.env.CODIGO_CADASTRO_PROFESSOR ?? '',
  },
  agenda: {
    /**
     * Disponibilidade e declarada em horario local ("terca, 14h"), enquanto o
     * atendimento e TIMESTAMPTZ. Este fuso e a ponte entre os dois, e a conversao
     * e feita pelo proprio PostgreSQL (AT TIME ZONE) para nao depender do fuso
     * do processo Node.
     */
    fusoHorario: process.env.TIMEZONE_INSTITUICAO ?? 'America/Sao_Paulo',

    /** D-15: limites de agendamento. Ver env.validation.ts para os defaults. */
    duracaoMinimaMinutos: Number(process.env.AGENDAMENTO_DURACAO_MINIMA_MINUTOS ?? 15),
    duracaoMaximaMinutos: Number(process.env.AGENDAMENTO_DURACAO_MAXIMA_MINUTOS ?? 240),
    antecedenciaMinimaMinutos: Number(process.env.AGENDAMENTO_ANTECEDENCIA_MINIMA_MINUTOS ?? 0),
    cancelamentoAntecedenciaMinutos: Number(
      process.env.CANCELAMENTO_ANTECEDENCIA_MINIMA_MINUTOS ?? 0,
    ),
  },
});

export type Configuracao = ReturnType<typeof configuration>;
