'use strict';

/**
 * Registra QUEM criou cada usuario.
 *
 * Motivacao: a partir de agora um PROFESSOR pode criar outros professores e
 * alunos. Como nao existe perfil ADMIN, isso significa que o conjunto de
 * professores se expande por decisao de qualquer professor ja existente — e um
 * professor pode criar monitorias e habilitar monitores (RN01).
 *
 * Sem esta coluna, nao haveria como responder "quem colocou esta pessoa aqui?".
 * E o mesmo raciocinio de `monitoria_participantes.habilitado_por_usuario_id`,
 * que ja existe justamente para tornar a RN01 auditavel e nao apenas obedecida.
 *
 * NULL significa auto-cadastro (POST /auth/registro/*), que continua existindo.
 * A FK e auto-referente e ON DELETE RESTRICT, como todo o resto do schema: o
 * rastro nao pode ser destruido junto com quem criou (RN10).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('usuarios', 'criado_por_usuario_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'usuarios', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    // Consulta natural: "quais contas este professor criou?".
    await queryInterface.addIndex('usuarios', ['criado_por_usuario_id'], {
      name: 'ix_usuarios_criado_por',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('usuarios', 'ix_usuarios_criado_por');
    await queryInterface.removeColumn('usuarios', 'criado_por_usuario_id');
  },
};
