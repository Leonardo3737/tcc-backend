'use strict';

/**
 * MATERIAL da monitoria.
 *
 * Nesta primeira versao o material e um LINK (drive, repositorio, video). As
 * colunas de arquivo ja existem no schema e a coluna `tipo` ja aceita 'ARQUIVO',
 * mas nenhum endpoint de upload foi implementado — ver a nota de escopo no
 * README. Deixar as colunas prontas custa nada agora e evita uma migration de
 * alteracao depois; construir o subsistema de storage custaria muito e nao e
 * necessario para a plataforma funcionar.
 *
 * O material pertence a MONITORIA, nao a disciplina. A disciplina e so um rotulo
 * de catalogo: quem define quem pode ver (RN07) e quem pode publicar (RN08) e a
 * participacao na monitoria.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('materiais', {
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
      // Autoria por USUARIO, nao por participante: o professor responsavel
      // tambem publica (RN08) e ele nao tem vinculo em monitoria_participantes.
      autor_usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      titulo: { type: Sequelize.STRING(150), allowNull: false },
      descricao: { type: Sequelize.TEXT, allowNull: true },
      tipo: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'LINK' },
      url: { type: Sequelize.TEXT, allowNull: true },

      // Reservadas para quando o upload for implementado. Ver D-05/D-19.
      arquivo_chave: { type: Sequelize.TEXT, allowNull: true },
      arquivo_nome_original: { type: Sequelize.STRING(255), allowNull: true },
      arquivo_mime: { type: Sequelize.STRING(120), allowNull: true },
      arquivo_tamanho_bytes: { type: Sequelize.BIGINT, allowNull: true },

      // Soft delete: remover material publicado nao apaga a linha (RN10).
      removido_em: { type: Sequelize.DATE, allowNull: true },
      removido_por_usuario_id: {
        type: Sequelize.UUID,
        allowNull: true,
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
      ALTER TABLE materiais
        ADD CONSTRAINT ck_material_tipo CHECK (tipo IN ('LINK', 'ARQUIVO')),
        ADD CONSTRAINT ck_material_payload CHECK (
          (tipo = 'LINK'    AND url IS NOT NULL AND arquivo_chave IS NULL) OR
          (tipo = 'ARQUIVO' AND arquivo_chave IS NOT NULL AND url IS NULL)
        ),
        ADD CONSTRAINT ck_material_remocao
          CHECK ((removido_em IS NULL) = (removido_por_usuario_id IS NULL));
    `);

    // Listagem padrao: materiais visiveis de uma monitoria, mais recentes primeiro.
    await queryInterface.addIndex('materiais', ['monitoria_id', 'removido_em', 'created_at'], {
      name: 'ix_materiais_monitoria',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('materiais');
  },
};
