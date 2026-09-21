'use strict';

/**
 * Catalogo minimo de disciplinas.
 *
 * Escopo deliberadamente pequeno: a plataforma nao e um sistema academico.
 * Nao ha carga horaria, ementa, pre-requisitos, curso, grade ou periodo
 * curricular — nada disso e necessario para operar uma monitoria. A disciplina
 * existe aqui para dar nome e codigo a monitoria, e mais nada.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('disciplinas', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      codigo: { type: Sequelize.CITEXT, allowNull: false, unique: true },
      nome: { type: Sequelize.STRING(150), allowNull: false },
      // Desativacao logica: uma disciplina que saiu da grade nao pode ser
      // apagada, porque monitorias passadas a referenciam (RN10).
      ativa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
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

    await queryInterface.addIndex('disciplinas', ['nome'], { name: 'ix_disciplinas_nome' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('disciplinas');
  },
};
