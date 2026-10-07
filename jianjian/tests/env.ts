import 'dotenv/config';

// 测试只连独立库，绝不碰开发库
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://mesh:mesh@localhost:5432/mesh_test';
process.env.AUTH_MODE = 'dev';
