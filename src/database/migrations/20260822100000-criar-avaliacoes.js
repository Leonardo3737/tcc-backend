'use strict';

/**
 * AVALIACAO do atendimento.
 *
 * Decisao central: a avaliacao referencia a INSCRICAO
 * (atendimento_participantes), nao o atendimento.
 *
 * Isso resolve a RN05 estruturalmente. So existe avaliacao a partir de uma linha
 * que ja prova que aquele aluno estava naquela sessao, com papel MONITORADO
 * daquela monitoria — tudo isso ja garantido pelas FKs compostas da tabela de
 * inscricoes. Nao ha como um terceiro avaliar um atendimento do qual nao
 * participou, nem por erro de programacao.
 *
 * O UNIQUE em atendimento_participante_id da a cardinalidade 1:0..1: cada aluno
 * avalia cada sessao no maximo uma vez. Em atendimento coletivo, a mesma sessao
 * recebe N avaliacoes — uma por monitorado.
 *
 * RN06 (avaliar apenas apos a conclusao) e a proibicao de avaliar cancelados
 * dependem do status do ATENDIMENTO e da INSCRICAO, em outras tabelas. CHECK nao
 * enxerga outra tabela, entao essas duas ficam no service (ver AvaliacoesService).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('avaliacoes', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      atendimento_participante_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'atendimento_participantes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      nota: { type: Sequelize.SMALLINT, allowNull: false },
      comentario: { type: Sequelize.TEXT, allowNull: true },
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
      ALTER TABLE avaliacoes
        ADD CONSTRAINT ck_avaliacao_nota CHECK (nota BETWEEN 1 AND 5),
        ADD CONSTRAINT ck_avaliacao_comentario
          CHECK (comentario IS NULL OR length(btrim(comentario)) > 0);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('avaliacoes');
  },
};
