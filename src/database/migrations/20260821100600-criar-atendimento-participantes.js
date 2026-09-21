'use strict';

/**
 * ATENDIMENTO_PARTICIPANTE: a inscricao de um monitorado em uma sessao.
 *
 * Segunda entidade associativa do dominio, encadeada com a primeira:
 * MONITORIA_PARTICIPANTE representa o vinculo com o PROGRAMA;
 * ATENDIMENTO_PARTICIPANTE representa a presenca em um ENCONTRO.
 *
 * As colunas `inicio` e `fim` sao denormalizadas do atendimento. Isso NAO e
 * descuido: sem elas a constraint EXCLUDE que garante a RN03 do lado do aluno
 * seria impossivel, porque o horario nao existiria nesta tabela. E a consistencia
 * da copia e mantida pelo proprio banco (ON UPDATE CASCADE), nunca por codigo.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('atendimento_participantes', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      atendimento_id: { type: Sequelize.UUID, allowNull: false },
      monitoria_id: { type: Sequelize.UUID, allowNull: false },
      inicio: { type: Sequelize.DATE, allowNull: false },
      fim: { type: Sequelize.DATE, allowNull: false },
      participante_id: { type: Sequelize.UUID, allowNull: false },
      papel_esperado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'MONITORADO' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'INSCRITO' },
      inscrito_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      inscrito_por_usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
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
      ALTER TABLE atendimento_participantes
        ADD CONSTRAINT ck_inscricao_papel CHECK (papel_esperado = 'MONITORADO'),
        ADD CONSTRAINT ck_inscricao_status
          CHECK (status IN ('INSCRITO', 'PRESENTE', 'AUSENTE', 'CANCELADA')),
        ADD CONSTRAINT ck_inscricao_intervalo CHECK (fim > inicio);
    `);

    /**
     * A FK de quatro colunas resolve duas coisas ao mesmo tempo:
     *  - `monitoria_id` na chave garante que a inscricao pertence a mesma
     *    monitoria da sessao;
     *  - `inicio` e `fim` na chave, com ON UPDATE CASCADE, fazem o reagendamento
     *    da sessao propagar sozinho para todas as inscricoes.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_participantes
        ADD CONSTRAINT fk_inscricao_atendimento
          FOREIGN KEY (atendimento_id, monitoria_id, inicio, fim)
          REFERENCES atendimentos (id, monitoria_id, inicio, fim)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    /**
     * RN04, lado do aluno: so participa do atendimento quem e participante
     * daquela monitoria — e, pela coluna `papel_esperado` na chave, apenas com
     * papel MONITORADO. Um MONITOR nao consegue se inscrever como atendido nem
     * por erro de programacao.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_participantes
        ADD CONSTRAINT fk_inscricao_participante
          FOREIGN KEY (participante_id, monitoria_id, papel_esperado)
          REFERENCES monitoria_participantes (id, monitoria_id, papel)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_participantes
        ADD CONSTRAINT uq_inscricao_unica UNIQUE (atendimento_id, participante_id);
    `);

    /**
     * RN03, lado do aluno: ninguem fica inscrito em duas sessoes sobrepostas,
     * nem que sejam de monitorias diferentes.
     *
     * Inscricoes CANCELADAS e faltas (AUSENTE) ficam de fora do indice: elas
     * permanecem no banco como historico (RN10), mas nao ocupam a agenda.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_participantes
        ADD CONSTRAINT ex_aluno_sem_conflito
          EXCLUDE USING gist (
            participante_id WITH =,
            tstzrange(inicio, fim) WITH &&
          ) WHERE (status IN ('INSCRITO', 'PRESENTE'));
    `);

    await queryInterface.addIndex('atendimento_participantes', ['participante_id', 'status'], {
      name: 'ix_inscricoes_participante_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('atendimento_participantes');
  },
};
