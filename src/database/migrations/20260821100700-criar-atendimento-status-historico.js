'use strict';

/**
 * Historico de transicoes de status do atendimento.
 *
 * A coluna `status` em `atendimentos` guarda apenas o estado ATUAL. Sem esta
 * tabela, cancelar um atendimento apagaria a informacao de que ele um dia esteve
 * agendado, e nao restaria registro de quem cancelou, quando, nem por que —
 * exatamente o tipo de perda que a RN10 proibe.
 *
 * Tabela append-only: nunca sofre UPDATE nem DELETE. Por isso nao tem
 * `updated_at`; apenas `criado_em`.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('atendimento_status_historico', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      atendimento_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'atendimentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      // NULL apenas na primeira linha, que registra a criacao do atendimento.
      status_anterior: { type: Sequelize.STRING(20), allowNull: true },
      status_novo: { type: Sequelize.STRING(20), allowNull: false },
      motivo: { type: Sequelize.TEXT, allowNull: true },
      alterado_por_usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_status_historico
        ADD CONSTRAINT ck_historico_status_novo
          CHECK (status_novo IN ('AGENDADO', 'REALIZADO', 'CANCELADO')),
        ADD CONSTRAINT ck_historico_status_anterior
          CHECK (status_anterior IS NULL
                 OR status_anterior IN ('AGENDADO', 'REALIZADO', 'CANCELADO')),
        ADD CONSTRAINT ck_historico_transicao
          CHECK (status_anterior IS DISTINCT FROM status_novo);
    `);

    await queryInterface.addIndex('atendimento_status_historico', ['atendimento_id', 'criado_em'], {
      name: 'ix_historico_atendimento',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('atendimento_status_historico');
  },
};
