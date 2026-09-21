'use strict';

/**
 * ATENDIMENTO: a sessao de monitoria.
 *
 * O atendimento pertence a um MONITOR e reune N monitorados (D-03), que vivem em
 * atendimento_participantes. Atendimento individual continua representavel — e
 * simplesmente uma sessao com `vagas = 1`, sem caminho de codigo separado.
 *
 * `inicio` e `fim` sao TIMESTAMPTZ: o banco guarda em UTC e a conversao para o
 * fuso da instituicao acontece na borda. Comparar intervalos em tipos sem fuso
 * quebraria silenciosamente no horario de verao.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('atendimentos', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      monitoria_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'monitorias', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      monitor_participante_id: { type: Sequelize.UUID, allowNull: false },
      monitor_papel: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'MONITOR' },
      inicio: { type: Sequelize.DATE, allowNull: false },
      fim: { type: Sequelize.DATE, allowNull: false },
      vagas: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 1 },
      modalidade: { type: Sequelize.STRING(20), allowNull: false },
      local: { type: Sequelize.STRING(150), allowNull: true },
      assunto: { type: Sequelize.STRING(200), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'AGENDADO' },
      origem: { type: Sequelize.STRING(30), allowNull: false },
      criado_por_usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      motivo_cancelamento: { type: Sequelize.TEXT, allowNull: true },
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
      ALTER TABLE atendimentos
        ADD CONSTRAINT ck_atendimento_papel CHECK (monitor_papel = 'MONITOR'),
        ADD CONSTRAINT ck_atendimento_intervalo CHECK (fim > inicio),
        ADD CONSTRAINT ck_atendimento_vagas CHECK (vagas >= 1),
        ADD CONSTRAINT ck_atendimento_modalidade
          CHECK (modalidade IN ('PRESENCIAL', 'REMOTO')),
        ADD CONSTRAINT ck_atendimento_status
          CHECK (status IN ('AGENDADO', 'REALIZADO', 'CANCELADO')),
        ADD CONSTRAINT ck_atendimento_origem
          CHECK (origem IN ('SOLICITACAO_ALUNO', 'OFERTA_MONITOR')),
        ADD CONSTRAINT ck_atendimento_cancelamento
          CHECK (status <> 'CANCELADO' OR motivo_cancelamento IS NOT NULL);
    `);

    /**
     * Quem conduz a sessao e obrigatoriamente um participante com papel MONITOR
     * DAQUELA monitoria. RN01, RN02 e RN04 do lado do monitor, garantidas por
     * integridade referencial em vez de validacao de aplicacao.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimentos
        ADD CONSTRAINT fk_atendimento_monitor
          FOREIGN KEY (monitor_participante_id, monitoria_id, monitor_papel)
          REFERENCES monitoria_participantes (id, monitoria_id, papel)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    /**
     * Alvo da FK composta das inscricoes. Incluir `inicio` e `fim` na chave
     * permite que o reagendamento do atendimento propague o novo horario para
     * todas as inscricoes via ON UPDATE CASCADE — sem trigger e sem codigo de
     * sincronizacao.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimentos
        ADD CONSTRAINT uq_atendimento_contexto UNIQUE (id, monitoria_id, inicio, fim);
    `);

    /**
     * RN03, lado do monitor: nenhum monitor conduz duas sessoes sobrepostas.
     *
     * Parcial de proposito — atendimentos CANCELADOS continuam no banco por causa
     * da RN10, mas nao devem bloquear a agenda do monitor.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimentos
        ADD CONSTRAINT ex_monitor_sem_conflito
          EXCLUDE USING gist (
            monitor_participante_id WITH =,
            tstzrange(inicio, fim) WITH &&
          ) WHERE (status IN ('AGENDADO', 'REALIZADO'));
    `);

    await queryInterface.addIndex('atendimentos', ['monitoria_id', 'status', 'inicio'], {
      name: 'ix_atendimentos_monitoria_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('atendimentos');
  },
};
