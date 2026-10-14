/**
 * Traduz variaveis de ambiente (strings) em um objeto de configuracao tipado.
 * Os services consomem isto via ConfigService, nunca process.env direto.
 */
export const configuration = () => ({
  app: {
    ambiente: process.env.NODE_ENV ?? 'development',
    porta: Number(process.env.PORT ?? 3000),
    prefixo: process.env.API_PREFIX ?? 'api',
    /**
     * Base dos links que vao nos e-mails.
     *
     * Separada de CORS_ORIGINS de proposito, apesar de normalmente coincidirem:
     * aquela e uma LISTA de origens que o navegador pode usar para chamar a API;
     * esta e UMA url canonica para montar link clicavel. Reaproveitar a primeira
     * obrigaria a escolher um item da lista arbitrariamente.
     */
    urlFront: (process.env.URL_FRONT ?? 'http://localhost:3001').replace(/\/+$/, ''),
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
  },
  /**
   * E-mail transacional (Brevo).
   *
   * Sem BREVO_API_KEY ou EMAIL_REMETENTE_EMAIL o servico opera em modo log.
   * Nao ha flag separada de liga/desliga de proposito: duas chaves que podem
   * se contradizer ("habilitado, mas sem chave") sao uma fonte de confusao a
   * mais. A presenca da credencial E a decisao.
   */
  email: {
    brevoApiKey: process.env.BREVO_API_KEY ?? '',
    remetenteNome: process.env.EMAIL_REMETENTE_NOME ?? 'Plataforma de Monitoria',
    remetenteEmail: process.env.EMAIL_REMETENTE_EMAIL ?? '',
  },
  /**
   * Avisos por e-mail. Desligados por padrao, deliberadamente.
   *
   * Um recurso que envia e-mail sozinho nao deve nascer ligado: em uma base de
   * desenvolvimento cheia de contas de teste com enderecos inexistentes, ligar
   * sem querer gera uma rajada de bounces que consome cota e prejudica a
   * reputacao do remetente.
   */
  /**
   * Trilha de requisicoes. LIGADA por padrao, ao contrario das notificacoes:
   * log nao tem efeito para fora, e uma API sem registro de acesso e pior que
   * uma com. O desligamento existe para medicao de desempenho e para testes.
   */
  logs: {
    habilitados: process.env.LOGS_REQUISICAO_HABILITADOS !== 'false',
  },
  notificacoes: {
    habilitadas: process.env.NOTIFICACOES_HABILITADAS === 'true',
  },
  agenda: {
    /**
     * Disponibilidade e declarada em horario local ("terca, 14h"), enquanto o
     * atendimento e TIMESTAMPTZ. Este fuso e a ponte entre os dois, e a conversao
     * e feita pelo proprio PostgreSQL (AT TIME ZONE) para nao depender do fuso
     * do processo Node.
     */
    fusoHorario: process.env.TIMEZONE_INSTITUICAO ?? 'America/Porto_Velho',

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
