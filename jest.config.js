/**
 * Testes de UNIDADE, sem banco.
 *
 * As regras que dependem do PostgreSQL (constraints EXCLUDE de RN03, indice
 * unico parcial de RN09) sao verificadas ponta a ponta por scripts/fluxo-completo.mjs,
 * contra um banco real — e nao aqui. Testar constraint de banco com model mockado
 * so provaria que o mock funciona.
 *
 * O que estes testes cobrem e a camada que o banco NAO alcanca: autorizacao,
 * papeis, transicoes de estado, propriedade de recurso e traducao de erro.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.service.ts', 'src/**/*.guard.ts', 'src/**/*.filter.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
