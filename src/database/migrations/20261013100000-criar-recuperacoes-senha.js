'use strict';

/**
 * Recuperacao de senha por codigo enviado ao e-mail.
 *
 * O codigo NAO e armazenado: guarda-se o hash argon2id, exatamente como a senha.
 * O motivo e o mesmo — quem obtiver uma copia do banco nao obtem um codigo
 * utilizavel. Um codigo de 6 digitos em texto claro seria credencial de troca de
 * senha disponivel em SELECT.
 *
 * `usado_em` e `invalidado_em` em vez de DELETE (RN10): uma tentativa de
 * recuperacao e justamente o tipo de fato que se quer poder auditar depois
 * ("quando foi pedida a troca e quando foi usada?"). Apagar a linha destruiria
 * essa informacao no exato caso em que ela importa.
 *
 * O indice unico PARCIAL e a regra central: no maximo UM codigo ativo por
 * usuario. Pedir um codigo novo invalida o anterior, e e o banco que impede os
 * dois de coexistirem — duas requisicoes simultaneas nao conseguem criar dois
 * codigos validos para a mesma conta. Mesmo padrao ja usado na RN09.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recuperacoes_senha', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },

      /** Hash argon2id do codigo. Nunca o codigo. */
      codigo_hash: { type: Sequelize.TEXT, allowNull: false },

      expira_em: { type: Sequelize.DATE, allowNull: false },

      /**
       * Tentativas erradas ja gastas neste codigo.
       *
       * Sem este contador, 6 digitos seriam 1.000.000 de possibilidades que um
       * script percorre em minutos. Com o teto, o espaco efetivo de ataque por
       * codigo e o numero de tentativas permitidas.
       */
      tentativas: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },

      /** Consumido com sucesso. Uso unico. */
      usado_em: { type: Sequelize.DATE, allowNull: true },

      /** Substituido por um pedido novo, expirado ou queimado por tentativas. */
      invalidado_em: { type: Sequelize.DATE, allowNull: true },

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
      ALTER TABLE recuperacoes_senha
        ADD CONSTRAINT ck_recuperacao_tentativas CHECK (tentativas >= 0);
    `);

    /**
     * No maximo um codigo ATIVO por usuario.
     *
     * Parcial porque codigos usados e invalidados permanecem na tabela: eles sao
     * historico, e historico nao pode bloquear um pedido novo.
     */
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_recuperacao_ativa_por_usuario
        ON recuperacoes_senha (usuario_id)
        WHERE usado_em IS NULL AND invalidado_em IS NULL;
    `);

    await queryInterface.addIndex('recuperacoes_senha', ['usuario_id'], {
      name: 'ix_recuperacao_usuario',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recuperacoes_senha');
  },
};
