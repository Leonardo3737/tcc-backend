'use strict';

/**
 * Especializacao 1:1 de USUARIO.
 *
 * A PK e a propria FK para `usuarios`. Isso resolve tres coisas de uma vez:
 *  - nao existe aluno sem usuario (FK);
 *  - nao existem dois alunos para o mesmo usuario (PK);
 *  - a cardinalidade 1:0..1 fica garantida pelo banco, nao por validacao.
 *
 * ON DELETE: RESTRICT, nunca CASCADE (AD-07 / RN10). Apagar um usuario nao pode
 * levar junto o historico academico dele. A saida do sistema e `ativo = false`.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alunos', {
      usuario_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      matricula: {
        type: Sequelize.STRING(30),
        allowNull: false,
        unique: true,
      },
      curso: {
        type: Sequelize.STRING(120),
        allowNull: true,
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('alunos');
  },
};
