'use strict';

const argon2 = require('argon2');

/**
 * Usuarios de DESENVOLVIMENTO, para testar autenticacao sem precisar cadastrar
 * tudo pela API a cada reset do banco.
 *
 * As senhas sao propositalmente obvias e estao versionadas: este seeder nunca
 * deve rodar em producao. Ele se recusa a executar se NODE_ENV = production.
 */
const OPCOES_HASH = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const ID_PROFESSOR = '11111111-1111-4111-8111-111111111111';
const ID_ALUNA = '22222222-2222-4222-8222-222222222222';

module.exports = {
  async up(queryInterface) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Este seeder e exclusivo de desenvolvimento.');
    }

    const agora = new Date();
    const senhaHash = await argon2.hash('senhaSegura123', OPCOES_HASH);

    await queryInterface.bulkInsert('usuarios', [
      {
        id: ID_PROFESSOR,
        nome: 'Joao Ribeiro',
        email: 'joao.ribeiro@ufx.edu.br',
        senha_hash: senhaHash,
        ativo: true,
        created_at: agora,
        updated_at: agora,
      },
      {
        id: ID_ALUNA,
        nome: 'Ana Martins',
        email: 'ana.martins@ufx.edu.br',
        senha_hash: senhaHash,
        ativo: true,
        created_at: agora,
        updated_at: agora,
      },
    ]);

    await queryInterface.bulkInsert('professores', [
      {
        usuario_id: ID_PROFESSOR,
        identificacao_funcional: '1234567',
        departamento: 'Departamento de Computacao',
        created_at: agora,
        updated_at: agora,
      },
    ]);

    await queryInterface.bulkInsert('alunos', [
      {
        usuario_id: ID_ALUNA,
        matricula: '2021001234',
        curso: 'Ciencia da Computacao',
        created_at: agora,
        updated_at: agora,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    const { Op } = Sequelize;
    const ids = [ID_PROFESSOR, ID_ALUNA];

    // Ordem inversa: as especializacoes referenciam `usuarios` com RESTRICT.
    await queryInterface.bulkDelete('professores', { usuario_id: { [Op.in]: ids } });
    await queryInterface.bulkDelete('alunos', { usuario_id: { [Op.in]: ids } });
    await queryInterface.bulkDelete('usuarios', { id: { [Op.in]: ids } });
  },
};
