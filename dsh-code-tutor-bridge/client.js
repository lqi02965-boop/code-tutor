window.__ModuleLoader__.load({
  id: '@local/code-tutor-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Same-origin relative routes served by the DSH Host webServer (code-tutor-bridge).
    // No hardcoded port: the page origin is the DSH web GUI itself.
    const STATUS_URL = 'code-tutor/status';
    const LAUNCH_URL = 'code-tutor/launch';

    function LaunchButton() {
      const [busy, setBusy] = React.useState(false);
      const [state, setState] = React.useState(''); // '', 'off'
      React.useEffect(() => {
        let alive = true;
        const poll = () => fetch(STATUS_URL)
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(j => { if (alive) setState(j.running ? '' : 'off'); })
          .catch(() => { if (alive) setState('off'); });
        poll();
        const t = setInterval(poll, 10000);
        return () => { alive = false; clearInterval(t); };
      }, []);
      const launch = async () => {
        setBusy(true);
        try {
          // Host route: shows the window, spawning it first when closed.
          const r = await fetch(LAUNCH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          const j = await r.json().catch(() => ({}));
          setState(j.ok && j.running !== false ? '' : (j.ok ? '' : 'off'));
        } catch { setState('off'); }
        setBusy(false);
      };
      return h('button', {
        type: 'button',
        title: state === 'off'
          ? 'Code Tutor 悬浮窗未运行，点击自动启动'
          : '打开 Code Tutor 代码助教悬浮窗',
        'aria-label': 'Code Tutor',
        disabled: busy,
        onClick: launch,
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, marginRight: 4,
          borderRadius: 'var(--dsw-radius-sm, 6px)',
          border: 'none', cursor: busy ? 'wait' : 'pointer',
          background: 'transparent',
          color: state === 'off' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)',
          fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
        },
        onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; },
        onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
      }, 'CT');
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'code-tutor-launch',
          order: 100,
        }, LaunchButton));
      },
    };
  },
});
