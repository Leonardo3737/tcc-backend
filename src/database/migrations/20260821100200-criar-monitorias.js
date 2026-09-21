'use strict';

/**
 * MONITORIA: o agregado central do dominio.
 *
 * Uma monitoria e a oferta de apoio academico de UMA disciplina, em UM periodo,
 * sob responsabilidade de UM professor. Como a monitoria aponta para exatamente
 * uma disciplina, a RN02 ("o monitor deve estar habilitado para a disciplina
 * correspondente") fica satisfeita por construcao: nao existe caminho no schema
 * para habilitar um monitor na disciplina errada.
 *
 * O periodo e representado por `ano` + `semestre` em vez de uma entidade
 * PERIODO_LETIVO (decisao D-01). Extrair a entidade depois nao exige reescrever
 * relacionamento nenhum, apenas mover duas colunas.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('monitorias', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      disciplina_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'disciplinas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      professor_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'professores', key: 'usuario_id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      ano: { type: Sequelize.SMALLINT, allowNull: false },
      semestre: { type: Sequelize.SMALLINT, allowNull: false },
      descricao: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'PLANEJADA' },
      data_inicio: { type: Sequelize.DATEONLY, allowNull: true },
      data_fim: { type: Sequelize.DATEONLY, allowNull: true },
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
      ALTER TABLE monitorias
        ADD CONSTRAINT ck_monitoria_ano CHECK (ano BETWEEN 2000 AND 2100),
        ADD CONSTRAINT ck_monitoria_semestre CHECK (semestre IN (1, 2)),
        ADD CONSTRAINT ck_monitoria_status
          CHECK (status IN ('PLANEJADA', 'ATIVA', 'ENCERRADA', 'CANCELADA')),
        ADD CONSTRAINT ck_monitoria_vigencia
          CHECK (data_inicio IS NULL OR data_fim IS NULL OR data_fim >= data_inicio);
    `);

    /**
     * D-02: um mesmo professor nao repete a monitoria da mesma disciplina no
     * mesmo periodo. Professores DIFERENTES podem ofertar a mesma disciplina no
     * mesmo periodo — por isso professor_id entra na chave.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitorias
        ADD CONSTRAINT uq_monitoria_oferta
          UNIQUE (disciplina_id, professor_id, ano, semestre);
    `);

    await queryInterface.addIndex('monitorias', ['professor_id', 'status'], {
      name: 'ix_monitorias_professor_status',
    });
    await queryInterface.addIndex('monitorias', ['ano', 'semestre'], {
      name: 'ix_monitorias_periodo',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('monitorias');
  },
};
