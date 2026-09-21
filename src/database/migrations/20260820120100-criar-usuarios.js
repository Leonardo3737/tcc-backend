'use strict';

/**
 * Tabela base da hierarquia de identidade (AD-03).
 *
 * NAO existe coluna `tipo` / `perfil` aqui, e isso e deliberado: o perfil e
 * DERIVADO da existencia das linhas em `alunos` / `professores`. Uma coluna de
 * tipo tornaria possivel um estado inconsistente (usuario marcado como ALUNO sem
 * linha em `alunos`) e nao permitiria acumular perfis.
 *
 * MONITOR e MONITORADO nao aparecem em lugar nenhum deste schema: sao papeis
 * contextuais por monitoria, modelados na fase 2 em monitoria_participantes.papel.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('usuarios', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      nome: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      email: {
        // CITEXT: unicidade case-insensitive garantida pelo banco.
        type: Sequelize.CITEXT,
        allowNull: false,
        unique: true,
      },
      senha_hash: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      ativo: {
        // Desativacao logica. RN10: nunca destruimos historico.
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    // Consultas de listagem ordenam por nome; consultas de login filtram por
    // email (ja coberto pelo indice unico).
    await queryInterface.addIndex('usuarios', ['nome'], { name: 'ix_usuarios_nome' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('usuarios');
  },
};
