// Mount the app — full-bleed on mobile, iPhone frame on desktop

function Mount() {
  const get = () => ({
    w: window.innerWidth || document.documentElement.clientWidth || 390,
    h: window.innerHeight || document.documentElement.clientHeight || 844,
  });
  const [vp, setVp] = React.useState(get);

  React.useEffect(() => {
    const onR = () => setVp(get());
    window.addEventListener('resize', onR);
    window.addEventListener('orientationchange', onR);
    const f = document.getElementById('fallback');
    if (f) f.style.display = 'none';
    return () => {
      window.removeEventListener('resize', onR);
      window.removeEventListener('orientationchange', onR);
    };
  }, []);

  // Always render full-bleed — no device frame chrome
  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: '#F9FAFB',
      display: 'flex', flexDirection: 'column',
      maxWidth: 480, margin: '0 auto',
      boxShadow: vp.w > 700 ? '0 20px 60px rgba(15,23,42,0.12)' : 'none',
    }}>
      <App />
    </div>
  );
}

const _stage = document.getElementById('stage');
ReactDOM.createRoot(_stage).render(<Mount />);
