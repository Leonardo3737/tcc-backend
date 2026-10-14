'use strict';

/**
 * Notificacoes por e-mail — registro de entrega, nao fila.
 *
 * A tabela existe por tres razoes, nesta ordem de importancia:
 *
 *  1. NAO REPETIR. Sem ela, reiniciar a aplicacao reenviaria todo lembrete do
 *     dia, e duas instancias enviariam em dobro. A UNIQUE abaixo e a garantia;
 *     o service apenas tenta inserir e trata a violacao como "ja avisado".
 *  2. PODER REENVIAR. O corpo fica gravado, entao uma falha do provedor nao
 *     perde a mensagem: a linha fica com `enviado_em` nulo e a rotina de
 *     reenvio a recolhe depois. Sem guardar o corpo, reenviar exigiria
 *     reconstruir a mensagem a partir de um estado que pode ter mudado.
 *  3. AUDITORIA. "O aluno foi avisado do cancelamento?" passa a ter resposta.
 *
 * `referencia_id` e referencia FRACA, sem FK, pela mesma razao ja registrada em
 * pontuacao_eventos: os tipos apontam para entidades diferentes (atendimento,
 * vinculo de monitoria, linha de historico) e uma FK obrigaria esta tabela a
 * conhecer todas elas, criando acoplamento reverso.
 *
 * ATENCAO ao escolher a referencia de cada tipo. Para LEMBRETE_DIA ela e o
 * atendimento — avisa-se uma vez e pronto. Para transicao de status ela e a
 * linha de `atendimento_status_historico`, que e append-only e portanto unica
 * por transicao. Usar o id do atendimento ali faria o SEGUNDO reagendamento ser
 * engolido pela UNIQUE: o sistema acharia que avisou, e ninguem receberia o
 * novo horario.
 */
const TIPOS = [
  'LEMBRETE_DIA',
  'ATENDIMENTO_CANCELADO',
  'ATENDIMENTO_REAGENDADO',
  'MONITOR_HABILITADO',
  'ATENDIMENTO_SOLICITADO',
  'ATENDIMENTO_OFERTADO',
  'AVALIACAO_PENDENTE',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    /**
     * TIPO no banco, e nao varchar + CHECK como nos demais enums do projeto.
     *
     * O nome segue a convencao do Sequelize (`enum_<tabela>_<coluna>`) porque e
     * o nome que o ORM assume ao gerar casts para colunas ENUM.
     */
    await queryInterface.sequelize.query(`
      CREATE TYPE enum_notificacoes_tipo AS ENUM (${TIPOS.map((t) => `'${t}'`).join(', ')});
    `);

    await queryInterface.createTable('notificacoes', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      tipo: { type: 'enum_notificacoes_tipo', allowNull: false },

      /** Id do fato que originou o aviso. Sem FK: ver o cabecalho. */
      referencia_id: { type: Sequelize.UUID, allowNull: false },

      assunto: { type: Sequelize.STRING(200), allowNull: false },
      corpo: { type: Sequelize.TEXT, allowNull: false },

      tentativas: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },

      /** Nulo = ainda nao entregue ao provedor. Preenchido = entregue. */
      enviado_em: { type: Sequelize.DATE, allowNull: true },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE notificacoes
        ADD CONSTRAINT ck_notificacao_tentativas CHECK (tentativas >= 0),
        ADD CONSTRAINT uq_notificacao_idempotente UNIQUE (tipo, referencia_id, usuario_id);
    `);

    /**
     * Indice PARCIAL para a rotina de reenvio.
     *
     * Ela procura sempre a mesma coisa: o que ainda nao saiu. Como esse conjunto
     * e minusculo perto do historico acumulado, indexar so ele mantem a consulta
     * barata independentemente de quantas notificacoes ja foram enviadas.
     */
    await queryInterface.sequelize.query(`
      CREATE INDEX ix_notificacao_pendente
        ON notificacoes (created_at)
        WHERE enviado_em IS NULL;
    `);

    await queryInterface.addIndex('notificacoes', ['usuario_id'], {
      name: 'ix_notificacao_usuario',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notificacoes');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_notificacoes_tipo;');
  },
};
