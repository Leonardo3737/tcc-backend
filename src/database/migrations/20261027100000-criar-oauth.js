'use strict';

/**
 * Servidor de autorizacao OAuth 2.1 para o conector MCP do Claude.
 *
 * Tres tabelas, cada uma com um ciclo de vida diferente:
 *
 * - oauth_clientes: quem pediu acesso (o Claude se registra sozinho via
 *   Dynamic Client Registration, RFC 7591). Cliente PUBLICO: nao ha segredo,
 *   a protecao do fluxo vem do PKCE.
 * - oauth_codigos: o codigo de autorizacao, de vida curtissima (minutos) e
 *   uso unico. Ele so existe entre o login do usuario e a troca por token.
 * - oauth_refresh_tokens: permite renovar o token de acesso sem novo login.
 *   Rotacionado a cada uso (OAuth 2.1 exige isso para clientes publicos).
 *
 * Codigos e refresh tokens NAO sao armazenados: guarda-se o SHA-256. Diferente
 * do codigo de recuperacao de senha (6 digitos, argon2), aqui o valor tem 256
 * bits aleatorios, entao forca bruta nao e um risco e o hash precisa ser
 * deterministico para a busca por indice funcionar.
 *
 * Como na recuperacao de senha, nada e apagado: `usado_em` e `revogado_em`
 * preservam o historico (RN10).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
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
    };

    await queryInterface.createTable('oauth_clientes', {
      /** O proprio id e o client_id entregue ao cliente. */
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      nome: { type: Sequelize.STRING(200), allowNull: true },
      redirect_uris: { type: Sequelize.ARRAY(Sequelize.TEXT), allowNull: false },
      ...timestamps,
    });

    await queryInterface.createTable('oauth_codigos', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      codigo_hash: { type: Sequelize.TEXT, allowNull: false, unique: true },
      cliente_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'oauth_clientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      /** A troca por token precisa repetir exatamente esta URI. */
      redirect_uri: { type: Sequelize.TEXT, allowNull: false },
      /** PKCE: SHA-256 do code_verifier, em base64url. */
      code_challenge: { type: Sequelize.TEXT, allowNull: false },
      escopo: { type: Sequelize.TEXT, allowNull: true },
      expira_em: { type: Sequelize.DATE, allowNull: false },
      usado_em: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });

    await queryInterface.createTable('oauth_refresh_tokens', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      token_hash: { type: Sequelize.TEXT, allowNull: false, unique: true },
      cliente_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'oauth_clientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      escopo: { type: Sequelize.TEXT, allowNull: true },
      expira_em: { type: Sequelize.DATE, allowNull: false },
      /** Usado (rotacionado) ou revogado. Nunca volta a valer. */
      revogado_em: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });

    await queryInterface.addIndex('oauth_refresh_tokens', ['cliente_id', 'usuario_id'], {
      name: 'ix_oauth_refresh_cliente_usuario',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('oauth_refresh_tokens');
    await queryInterface.dropTable('oauth_codigos');
    await queryInterface.dropTable('oauth_clientes');
  },
};
