'use strict';

/**
 * Gamificacao: um LIVRO-RAZAO de eventos de pontuacao, nao um saldo.
 *
 * A alternativa obvia seria uma coluna `pontos` em `usuarios`, incrementada a
 * cada atendimento. Foi descartada por tres motivos:
 *
 *  1. um saldo nao explica de onde veio — nao da para auditar nem contestar;
 *  2. mudar a regra de pontuacao exigiria recalcular saldos, sem base para isso;
 *  3. um UPDATE concorrente em `usuarios.pontos` e ponto de contencao e de perda
 *     silenciosa de escrita.
 *
 * Com o razao, o ranking e uma agregacao (SUM ... GROUP BY) e a evolucao futura
 * para badges, niveis e recompensas nao mexe no schema: badge e uma regra que le
 * estes eventos; nivel e uma faixa da soma. Nada disso precisa existir agora.
 *
 * A UNIQUE (tipo, referencia_id, usuario_id) torna a concessao IDEMPOTENTE: se o
 * mesmo evento de dominio for processado duas vezes, a segunda tentativa e
 * recusada pelo banco em vez de dobrar a pontuacao.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pontuacao_eventos', {
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
      // A monitoria em que o ponto foi ganho: permite ranking por monitoria sem
      // precisar navegar de volta ate o atendimento.
      monitoria_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'monitorias', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      tipo: { type: Sequelize.STRING(40), allowNull: false },
      pontos: { type: Sequelize.SMALLINT, allowNull: false },

      /**
       * Referencia FRACA de proposito: guarda o id do fato que gerou os pontos
       * (um atendimento, uma avaliacao) sem FK.
       *
       * Uma FK aqui obrigaria a tabela a conhecer todas as origens possiveis e
       * criaria acoplamento reverso — gamificacao passaria a restringir o que
       * atendimentos podem fazer. O razao apenas registra; ele nao manda.
       */
      referencia_id: { type: Sequelize.UUID, allowNull: false },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE pontuacao_eventos
        ADD CONSTRAINT ck_pontuacao_tipo
          CHECK (tipo IN ('ATENDIMENTO_REALIZADO', 'PARTICIPACAO_ATENDIMENTO', 'AVALIACAO_RECEBIDA')),
        ADD CONSTRAINT ck_pontuacao_pontos CHECK (pontos > 0),
        ADD CONSTRAINT uq_pontuacao_idempotente UNIQUE (tipo, referencia_id, usuario_id);
    `);

    await queryInterface.addIndex('pontuacao_eventos', ['usuario_id'], {
      name: 'ix_pontuacao_usuario',
    });
    await queryInterface.addIndex('pontuacao_eventos', ['monitoria_id', 'usuario_id'], {
      name: 'ix_pontuacao_monitoria_usuario',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pontuacao_eventos');
  },
};
