'use strict';

/**
 * Uma disciplina pertence a VARIOS cursos.
 *
 * Correcao de modelagem: "Banco de Dados" e disciplina de Sistemas de
 * Informacao E de Engenharia da Computacao. A versao anterior amarrava
 * `disciplinas.curso_id` a um unico curso, o que obrigaria a cadastrar a mesma
 * disciplina uma vez por curso, com codigos diferentes.
 *
 * ---------------------------------------------------------------------------
 * A REGRA CONTINUA NO BANCO — muda o caminho, nao a garantia
 *
 * A cadeia antiga passava por `disciplinas (id, curso_id)`, que deixou de
 * existir como par unico. O mesmo recurso continua valendo apontando para a
 * tabela de associacao, cuja PK e exatamente esse par:
 *
 *   monitoria_participantes (aluno_id, curso_id)
 *     -> alunos (usuario_id, curso_id)
 *   monitoria_participantes (monitoria_id, disciplina_id)
 *     -> monitorias (id, disciplina_id)
 *   monitoria_participantes (disciplina_id, curso_id)
 *     -> disciplina_cursos (disciplina_id, curso_id)
 *
 * Lidas juntas: o curso do vinculo e o do ALUNO; a disciplina do vinculo e a da
 * MONITORIA; e o par (disciplina, curso) tem de existir na associacao. Ou seja,
 * o curso do aluno precisa estar entre os cursos da disciplina — que e a regra,
 * agora sem exigir que a disciplina tenha um curso so.
 *
 * ---------------------------------------------------------------------------
 * `monitorias.curso_id` SAI
 *
 * Uma monitoria de Banco de Dados atende os alunos de todos os cursos que
 * oferecem a disciplina. Guardar um curso unico nela obrigaria o professor a
 * criar uma monitoria por curso, que e justamente o que esta correcao desfaz.
 * O vinculo passa a carregar `disciplina_id` no lugar — vindo da monitoria,
 * mantido em sincronia por FK composta com ON UPDATE CASCADE.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('disciplina_cursos', {
      disciplina_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'disciplinas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      curso_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'cursos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    /**
     * A PK composta e o alvo da FK que sustenta a regra — nao e so chave
     * tecnica. E tambem o que impede associar o mesmo curso duas vezes.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE disciplina_cursos
        ADD CONSTRAINT pk_disciplina_curso PRIMARY KEY (disciplina_id, curso_id);
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO disciplina_cursos (disciplina_id, curso_id)
      SELECT id, curso_id FROM disciplinas;
    `);

    /**
     * O vinculo passa a carregar `disciplina_id`, vindo da monitoria.
     *
     * E a ponte entre "qual disciplina" e "qual curso": sem ela nao haveria como
     * exigir, em uma FK, que o curso do aluno esteja entre os da disciplina.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes ADD COLUMN disciplina_id uuid;
      UPDATE monitoria_participantes mp SET disciplina_id = m.disciplina_id
        FROM monitorias m WHERE m.id = mp.monitoria_id;
      ALTER TABLE monitoria_participantes
        ALTER COLUMN disciplina_id SET NOT NULL,
        DROP CONSTRAINT fk_participante_monitoria_curso;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE monitorias
        DROP CONSTRAINT fk_monitoria_disciplina_curso,
        DROP CONSTRAINT uq_monitoria_curso,
        DROP COLUMN curso_id,
        ADD CONSTRAINT uq_monitoria_disciplina UNIQUE (id, disciplina_id);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE disciplinas
        DROP CONSTRAINT fk_disciplina_curso,
        DROP CONSTRAINT uq_disciplina_curso,
        DROP COLUMN curso_id;
    `);

    /**
     * As duas FKs que fecham a regra.
     *
     * A segunda e a que importa: ela recusa qualquer vinculo cujo par
     * (disciplina, curso do aluno) nao exista na associacao. Como o curso vem
     * do aluno e a disciplina vem da monitoria, nao ha combinacao valida para
     * um aluno de curso que nao oferece a disciplina.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes
        ADD CONSTRAINT fk_participante_monitoria_disciplina
          FOREIGN KEY (monitoria_id, disciplina_id) REFERENCES monitorias (id, disciplina_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT fk_participante_disciplina_curso
          FOREIGN KEY (disciplina_id, curso_id) REFERENCES disciplina_cursos (disciplina_id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    /**
     * `fk_participante_aluno_curso` passa de CASCADE para RESTRICT.
     *
     * Com CASCADE, trocar o aluno de curso reescreveria o curso de vinculos
     * PASSADOS — afirmando retroativamente que uma monitoria cursada ocorreu em
     * outro curso. A RN10 preserva historico; RESTRICT faz o banco recusar a
     * troca, que e o mesmo que o service ja responde com 409.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes
        DROP CONSTRAINT fk_participante_aluno_curso,
        ADD CONSTRAINT fk_participante_aluno_curso
          FOREIGN KEY (aluno_id, curso_id) REFERENCES alunos (usuario_id, curso_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT;
    `);

    await queryInterface.addIndex('disciplina_cursos', ['curso_id'], {
      name: 'ix_disciplina_curso_por_curso',
    });
  },

  async down(queryInterface, Sequelize) {
    /**
     * A volta assume que cada disciplina tem UM curso — o modelo que esta
     * migration desfez. Se alguma tiver mais de um, o primeiro por `created_at`
     * e mantido e os demais sao perdidos: nao ha como representar N cursos na
     * coluna unica que existia antes.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE disciplinas ADD COLUMN curso_id uuid;
      UPDATE disciplinas d SET curso_id = (
        SELECT dc.curso_id FROM disciplina_cursos dc
         WHERE dc.disciplina_id = d.id ORDER BY dc.created_at LIMIT 1);
      ALTER TABLE disciplinas
        ALTER COLUMN curso_id SET NOT NULL,
        ADD CONSTRAINT fk_disciplina_curso
          FOREIGN KEY (curso_id) REFERENCES cursos (id) ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_disciplina_curso UNIQUE (id, curso_id);

      ALTER TABLE monitorias ADD COLUMN curso_id uuid;
      UPDATE monitorias m SET curso_id = d.curso_id
        FROM disciplinas d WHERE d.id = m.disciplina_id;
      ALTER TABLE monitorias
        ALTER COLUMN curso_id SET NOT NULL,
        DROP CONSTRAINT uq_monitoria_disciplina,
        ADD CONSTRAINT fk_monitoria_disciplina_curso
          FOREIGN KEY (disciplina_id, curso_id) REFERENCES disciplinas (id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_monitoria_curso UNIQUE (id, curso_id);

      ALTER TABLE monitoria_participantes
        DROP CONSTRAINT fk_participante_disciplina_curso,
        DROP CONSTRAINT fk_participante_monitoria_disciplina,
        DROP CONSTRAINT fk_participante_aluno_curso,
        DROP COLUMN disciplina_id,
        ADD CONSTRAINT fk_participante_monitoria_curso
          FOREIGN KEY (monitoria_id, curso_id) REFERENCES monitorias (id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT fk_participante_aluno_curso
          FOREIGN KEY (aluno_id, curso_id) REFERENCES alunos (usuario_id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    await queryInterface.dropTable('disciplina_cursos');
    void Sequelize;
  },
};
