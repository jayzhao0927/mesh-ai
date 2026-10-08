import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少必需环境变量 ${name}`);
  return v;
}

export const config = {
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
  authMode: process.env.AUTH_MODE ?? 'dev', // dev | otp
  authSecret: process.env.AUTH_SECRET ?? 'dev-secret',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mesh:mesh@localhost:5432/mesh',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  },
  wechat: {
    appId: process.env.WECHAT_APP_ID ?? '',
    appSecret: process.env.WECHAT_APP_SECRET ?? '',
    templateRecommend: process.env.WECHAT_TEMPLATE_RECOMMEND ?? '',
    templateVideo: process.env.WECHAT_TEMPLATE_VIDEO ?? '',
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'aliyun',
    accessKey: process.env.SMS_ACCESS_KEY ?? '',
    accessSecret: process.env.SMS_ACCESS_SECRET ?? '',
    signName: process.env.SMS_SIGN_NAME ?? '',
    templateCode: process.env.SMS_TEMPLATE_CODE ?? '',
  },
  trtc: {
    sdkAppId: process.env.TRTC_SDK_APP_ID ?? '',
    secretKey: process.env.TRTC_SECRET_KEY ?? '',
  },
};

export function requireDeepSeek() {
  if (!config.deepseek.apiKey) throw new Error('DEEPSEEK_API_KEY 未配置');
}
