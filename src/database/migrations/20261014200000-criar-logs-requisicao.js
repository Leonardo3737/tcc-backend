'use strict';

/**
 * Trilha de requisicoes.
 *
 * Uma linha por requisicao HTTP atendida. Serve para tres perguntas que hoje nao
 * tem resposta depois do fato: o que o cliente mandou, o que a API respondeu, e
 * quem estava autenticado quando isso aconteceu.
 *
 * NAO e auditoria de dominio. Quem alterou o que ja esta registrado nas proprias
 * tabelas (`atendimento_status_historico`, `criado_por_usuario_id`,
 * `habilitado_por_usuario_id`), com significado e integridade garantidos por FK.
 * Esta tabela e sobre o TRANSPORTE — util para diagnosticar integracao com o
 * frontend e investigar acesso indevido, nao para reconstruir regra de negocio.
 *
 * `usuario_id` e NULO em requisicao anonima (login, recuperacao de senha) e
 * NAO tem FK de proposito: uma FK impediria remover um usuario enquanto
 * houvesse log dele, e transformaria a politica de retencao do log em um
 * problema do cadastro. A mesma escolha ja registrada em `pontuacao_eventos` e
 * `notificacoes`.
 *
 * ATENCAO ao conteudo: `corpo` e `resposta` passam pela redacao em
 * src/modules/logs/redacao.ts. Gravar sem filtrar colocaria senha, codigo de
 * recuperacao e token em texto claro numa tabela de leitura ampla.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('logs_requisicao', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      /** Nulo quando a requisicao nao estava autenticada. Sem FK: ver o cabecalho. */
      usuario_id: { type: Sequelize.UUID, allowNull: true },

      metodo: { type: Sequelize.STRING(10), allowNull: false },

      /** Caminho concreto, com ids: /api/monitorias/abc-123/atendimentos */
      caminho: { type: Sequelize.STRING(500), allowNull: false },

      /**
       * Caminho com parametros: /api/monitorias/:monitoriaId/atendimentos
       *
       * Existe para agregacao. Sem ele, "quais rotas mais falham?" seria uma
       * consulta sobre milhares de caminhos unicos, um por id.
       */
      rota: { type: Sequelize.STRING(300), allowNull: true },

      status_http: { type: Sequelize.SMALLINT, allowNull: false },
      duracao_ms: { type: Sequelize.INTEGER, allowNull: false },

      corpo: { type: Sequelize.TEXT, allowNull: true },
      query: { type: Sequelize.TEXT, allowNull: true },
      resposta: { type: Sequelize.TEXT, allowNull: true },

      /** Mensagem do erro quando houve. Nulo em requisicao bem-sucedida. */
      erro: { type: Sequelize.TEXT, allowNull: true },

      ip: { type: Sequelize.STRING(60), allowNull: true },
      user_agent: { type: Sequelize.STRING(300), allowNull: true },

      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE logs_requisicao
        ADD CONSTRAINT ck_log_status CHECK (status_http BETWEEN 100 AND 599),
        ADD CONSTRAINT ck_log_duracao CHECK (duracao_ms >= 0);
    `);

    /** A consulta mais comum: o que aconteceu nos ultimos minutos. */
    await queryInterface.addIndex('logs_requisicao', ['criado_em'], {
      name: 'ix_log_criado_em',
    });

    /** "O que este usuario fez?" — investigacao de acesso indevido. */
    await queryInterface.addIndex('logs_requisicao', ['usuario_id', 'criado_em'], {
      name: 'ix_log_usuario',
    });

    /**
     * Indice PARCIAL para falhas.
     *
     * "O que esta dando errado?" olha so o que falhou, que e uma fracao minuscula
     * do total. Indexar apenas essas linhas mantem a consulta barata por mais
     * tempo e deixa o indice pequeno.
     */
    await queryInterface.sequelize.query(`
      CREATE INDEX ix_log_falhas
        ON logs_requisicao (criado_em)
        WHERE status_http >= 400;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('logs_requisicao');
  },
};
