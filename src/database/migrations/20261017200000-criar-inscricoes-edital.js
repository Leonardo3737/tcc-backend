'use strict';

/**
 * INSCRICAO EM EDITAL — candidatura de alguem que pode nao ter conta.
 *
 * Esta e a primeira entidade do projeto que guarda dados de uma pessoa SEM
 * linha em `usuarios`. E deliberado: exigir conta para se candidatar inverteria
 * a ordem dos fatos, ja que a conta do monitor e criada pelo professor DEPOIS
 * da aprovacao. Por isso nome, matricula e e-mail estao aqui como colunas, e
 * nao como FK para `alunos` — nao ha nada para referenciar na maioria dos
 * casos.
 *
 * Nao existe FK opcional para `alunos`: um candidato que ja e aluno hoje seria
 * ligado, e um que se cadastra depois ficaria com a coluna nula para sempre,
 * fazendo a mesma pergunta ter duas respostas diferentes dependendo da ordem
 * dos acontecimentos. O cruzamento por matricula e feito na LEITURA, onde o
 * resultado e sempre o estado atual.
 *
 * ---------------------------------------------------------------------------
 * COMPATIBILIDADE CURSO x DISCIPLINA — no banco, como as demais RN
 *
 * "A disciplina selecionada deve pertencer ao curso informado" nao e checagem
 * de service: e uma FK COMPOSTA para a tabela de associacao, exatamente o
 * recurso que `monitoria_participantes` usa para a regra equivalente.
 *
 *   inscricoes_edital (disciplina_id, curso_id) -> disciplina_cursos (disciplina_id, curso_id)
 *
 * `curso_id` e `disciplina_id` tambem tem FK simples para as proprias tabelas.
 * Nao e redundancia inutil: a composta garante que o PAR existe, e as simples
 * sao o que impede apagar um curso ou uma disciplina ainda referenciados por
 * candidatura.
 *
 * ---------------------------------------------------------------------------
 * `media` E COLUNA GERADA — o cliente nao tem como escreve-la
 *
 * A exigencia e "o cliente nao deve poder definir ou sobrescrever a media".
 * Calcular no service atende ao pedido pela via mais fragil possivel: um script
 * de manutencao, um seed ou um INSERT direto furam a garantia sem esforco.
 *
 * GENERATED ALWAYS AS ... STORED torna a coluna nao-gravavel pelo proprio
 * PostgreSQL: qualquer INSERT ou UPDATE que a mencione e recusado com erro, e
 * o valor e sempre funcao de n1 e n2. Nao ha caminho que produza media
 * divergente das notas.
 *
 * O `round(..., 2)` e explicito para a conta nao depender do arredondamento
 * implicito do cast para NUMERIC(4,2): com duas casas em cada nota, a media
 * pode ter tres (9.33 e 9.34 -> 9.335), e o comportamento precisa estar escrito.
 *
 * NOTA AUSENTE -> MEDIA NULA. Em SQL, qualquer aritmetica com NULL e NULL,
 * entao a regra "nao atribua zero quando a nota estiver ausente" e consequencia
 * do tipo, nao de um `if`. A ordenacao usa NULLS LAST para que a ausencia nao
 * seja lida como nota baixa.
 */
const TURNOS = ['MATUTINO', 'VESPERTINO', 'NOTURNO'];

module.exports = {
  async up(queryInterface, Sequelize) {
    /**
     * TIPO no banco, seguindo a convencao `enum_<tabela>_<coluna>` que o
     * Sequelize assume ao gerar casts — a mesma escolha de
     * `enum_notificacoes_tipo`. Acrescentar um turno passa a exigir
     * `ALTER TYPE ... ADD VALUE` em migration.
     */
    await queryInterface.sequelize.query(
      `CREATE TYPE enum_inscricoes_edital_turno AS ENUM (${TURNOS.map((t) => `'${t}'`).join(', ')});`,
    );

    await queryInterface.createTable('inscricoes_edital', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      edital_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'editais', key: 'id' },
        onUpdate: 'CASCADE',
        /** RESTRICT: edital com candidatura nao se apaga. Ver `editais.ativo`. */
        onDelete: 'RESTRICT',
      },

      /** Dados da PESSOA, nao de um usuario. Ver o cabecalho. */
      nome_completo: { type: Sequelize.STRING(150), allowNull: false },
      matricula: { type: Sequelize.STRING(30), allowNull: false },
      /** CITEXT como em `usuarios.email`: a unicidade por edital ignora caixa. */
      email: { type: 'CITEXT', allowNull: false },

      curso_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'cursos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      disciplina_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'disciplinas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },

      /**
       * Professor responsavel. A PK de `professores` e `usuario_id` (AD-03), e
       * e para ela que a FK aponta — nao para `usuarios`: so quem TEM linha de
       * professor pode ser responsavel por uma candidatura.
       */
      professor_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'professores', key: 'usuario_id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },

      turno: { type: 'enum_inscricoes_edital_turno', allowNull: false },

      /**
       * NUMERIC, nao float. Nota e valor decimal exato de uso administrativo:
       * `double precision` faria 9.1 virar 9.099999999999999 e duas medias
       * iguais compararem diferentes na ordenacao.
       *
       * Nulas de proposito: o candidato pode nao ter a nota ainda.
       */
      n1: { type: Sequelize.DECIMAL(4, 2), allowNull: true },
      n2: { type: Sequelize.DECIMAL(4, 2), allowNull: true },

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

    /** A coluna gerada nao e criavel por `createTable`: ver o cabecalho. */
    await queryInterface.sequelize.query(`
      ALTER TABLE inscricoes_edital
        ADD COLUMN media numeric(4,2)
          GENERATED ALWAYS AS (round((n1 + n2) / 2, 2)) STORED;
    `);

    /**
     * UMA candidatura por pessoa em cada edital, por matricula E por e-mail.
     *
     * As duas sao necessarias e nenhuma e redundante: so a matricula nao impede
     * a mesma pessoa se inscrever duas vezes digitando matriculas diferentes
     * com o mesmo e-mail, e so o e-mail nao impede duas pessoas reusarem um
     * endereco de familia com matriculas distintas.
     *
     * E tambem o que torna a retentativa do candidato INOCUA: a segunda
     * tentativa e recusada pelo banco antes de qualquer insercao, entao nao ha
     * como gerar inscricao duplicada nem um segundo e-mail de confirmacao.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE inscricoes_edital
        ADD CONSTRAINT ck_inscricao_n1 CHECK (n1 IS NULL OR (n1 >= 0 AND n1 <= 10)),
        ADD CONSTRAINT ck_inscricao_n2 CHECK (n2 IS NULL OR (n2 >= 0 AND n2 <= 10)),
        ADD CONSTRAINT ck_inscricao_nome CHECK (btrim(nome_completo) <> ''),
        ADD CONSTRAINT ck_inscricao_matricula CHECK (btrim(matricula) <> ''),
        ADD CONSTRAINT fk_inscricao_disciplina_curso
          FOREIGN KEY (disciplina_id, curso_id)
          REFERENCES disciplina_cursos (disciplina_id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_inscricao_edital_matricula UNIQUE (edital_id, matricula),
        ADD CONSTRAINT uq_inscricao_edital_email UNIQUE (edital_id, email);
    `);

    /** Indices dos filtros obrigatorios da listagem administrativa. */
    await queryInterface.addIndex('inscricoes_edital', ['edital_id', 'curso_id'], {
      name: 'ix_inscricao_edital_curso',
    });
    await queryInterface.addIndex('inscricoes_edital', ['edital_id', 'disciplina_id'], {
      name: 'ix_inscricao_edital_disciplina',
    });
    await queryInterface.addIndex('inscricoes_edital', ['edital_id', 'turno'], {
      name: 'ix_inscricao_edital_turno',
    });
    await queryInterface.addIndex('inscricoes_edital', ['professor_id'], {
      name: 'ix_inscricao_professor',
    });

    /**
     * A ordenacao padrao da banca e por media decrescente dentro de um edital.
     * NULLS LAST no indice espelha o ORDER BY usado no service — indice com
     * ordenacao diferente da consulta nao e aproveitado.
     */
    await queryInterface.sequelize.query(`
      CREATE INDEX ix_inscricao_media ON inscricoes_edital (edital_id, media DESC NULLS LAST);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inscricoes_edital');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_inscricoes_edital_turno;');
  },
};
