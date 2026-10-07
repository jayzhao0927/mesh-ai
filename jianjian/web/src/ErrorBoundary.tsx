import { Component, type ReactNode } from 'react';
import { session } from './api';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('页面渲染出错', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="shell login">
        <div className="card center">
          <h2>页面出了点问题</h2>
          <p className="small muted">{this.state.error.message}</p>
          <button className="primary" onClick={() => location.reload()}>
            刷新重试
          </button>
          <button
            className="ghost"
            onClick={() => {
              session.clear();
              location.assign('/');
            }}
          >
            退出登录并回到首页
          </button>
        </div>
      </div>
    );
  }
}
