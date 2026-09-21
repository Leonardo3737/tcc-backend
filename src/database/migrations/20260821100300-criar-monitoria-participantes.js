'use strict';

/**
 * MONITORIA_PARTICIPANTE: a entidade que resolve o nucleo do dominio.
 *
 * ALUNO x MONITORIA e uma relacao N:M COM ATRIBUTOS, e `papel` e o atributo mais
 * importante deles. E aqui — e somente aqui — que MONITOR e MONITORADO existem.
 * Nao ha tabela de monitores, nem coluna `tipo` em usuarios, nem subtipo: o papel
 * so faz sentido qualificado por uma monitoria.
 *
 * Esta tabela tambem E a habilitacao da RN01: habilitar um aluno como monitor e
 * exatamente criar aqui uma linha com papel = MONITOR, registrando em
 * `habilitado_por_usuario_id` qual professor autorizou.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('monitoria_participantes', {
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
      aluno_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'alunos', key: 'usuario_id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      papel: { type: Sequelize.STRING(20), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'ATIVO' },
      ingressou_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      encerrado_em: { type: Sequelize.DATE, allowNull: true },
      habilitado_por_usuario_id: {
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
      ALTER TABLE monitoria_participantes
        ADD CONSTRAINT ck_participante_papel
          CHECK (papel IN ('MONITOR', 'MONITORADO')),
        ADD CONSTRAINT ck_participante_status
          CHECK (status IN ('ATIVO', 'ENCERRADO')),
        ADD CONSTRAINT ck_participante_encerramento
          CHECK ((status = 'ENCERRADO') = (encerrado_em IS NOT NULL));
    `);

    /**
     * RN09 sem uma unica linha de codigo.
     *
     * O indice e PARCIAL (apenas vinculos ATIVOS): isso proibe acumular os dois
     * papeis simultaneamente e, ao mesmo tempo, PERMITE o historico exigido pela
     * RN10. Um aluno que foi MONITORADO no periodo passado e virou MONITOR agora
     * tem duas linhas — uma ENCERRADA e uma ATIVA — e nenhuma delas e destruida.
     */
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX ux_participante_ativo
        ON monitoria_participantes (monitoria_id, aluno_id)
        WHERE status = 'ATIVO';
    `);

    /**
     * Alvo das chaves estrangeiras compostas de disponibilidades, atendimentos e
     * atendimento_participantes.
     *
     * Incluir `monitoria_id` faz o banco garantir a RN04 (o participante e da
     * mesma monitoria do atendimento). Incluir `papel` faz o banco garantir que
     * quem atende e MONITOR e quem e atendido e MONITORADO — nao por validacao
     * de service, mas por integridade referencial.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes
        ADD CONSTRAINT uq_participante_contexto UNIQUE (id, monitoria_id, papel);
    `);

    await queryInterface.addIndex('monitoria_participantes', ['aluno_id', 'status'], {
      name: 'ix_participantes_aluno_status',
    });
    await queryInterface.addIndex('monitoria_participantes', ['monitoria_id', 'papel', 'status'], {
      name: 'ix_participantes_monitoria_papel',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('monitoria_participantes');
  },
};
