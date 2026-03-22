import { useState, useEffect, useRef } from 'react';
import Lenis from 'lenis';
import './index.css';

/* ─── DATA ───────────────────────────────────────────────────── */
const services = [
  { id:1,  icon:'fa-solid fa-rocket',        type:'Landing Page',           price:'10,000 – 18,000',  best:'Single product or service promo with a high-conversion contact form.',   features:['1–3 Sections','Contact Form','Mobile Responsive','SEO Ready'],              tier:'starter'            },
  { id:2,  icon:'fa-solid fa-user-tie',       type:'Personal Portfolio',     price:'15,000 – 25,000',  best:'Freelancers, designers, developers and professionals.',                  features:['Portfolio Gallery','About & CV','Contact Form','Blog Ready'],                tier:'starter'            },
  { id:3,  icon:'fa-solid fa-store',          type:'Small Business Website', price:'25,000 – 50,000',  best:'Local businesses with About, Contact, Blog and Google Maps.',           features:['5–8 Pages','Google Maps','WhatsApp Button','Blog Module'],                   tier:'starter'            },
  { id:4,  icon:'fa-solid fa-building',       type:'Corporate Website',      price:'70,000 – 160,000', best:'Full brand presentation with advanced pages, CMS and analytics.',       features:['Unlimited Pages','Admin Dashboard','Team & Career','Analytics'],             tier:'popular', featured:true },
  { id:5,  icon:'fa-solid fa-newspaper',      type:'Blog / News Portal',     price:'20,000 – 45,000',  best:'News websites, magazines and content-driven platforms.',                features:['CMS Powered','Categories & Tags','Author Profiles','Newsletter'],            tier:'starter'            },
  { id:6,  icon:'fa-solid fa-cart-shopping',  type:'Basic E-Commerce',       price:'60,000 – 100,000', best:'Online stores with product catalog, cart and checkout.',                features:['Product Catalog','Cart & Checkout','Order Management','Payments'],           tier:'pro'                },
  { id:7,  icon:'fa-solid fa-graduation-cap', type:'E-Learning Platform',    price:'90,000 – 200,000', best:'Online courses with student dashboard and progress tracking.',          features:['Course Builder','Student Portal','Quizzes & Certs','Video Hosting'],         tier:'pro'                },
  { id:8,  icon:'fa-solid fa-hotel',          type:'Hotel Booking Website',  price:'50,000 – 100,000', best:'Hotel reservations, room management and booking calendar.',             features:['Room Listings','Booking Calendar','Payment Integration','Admin Panel'],      tier:'pro'                },
  { id:9,  icon:'fa-solid fa-briefcase',      type:'Job Board Platform',     price:'70,000 – 150,000', best:'Recruitment platforms with job listings and employer dashboard.',       features:['Job Listings','Employer Portal','CV Upload','Email Alerts'],                 tier:'pro'                },
  { id:10, icon:'fa-solid fa-mobile-screen',  type:'Mobile App + Web System',price:'280,000 – 1M+',   best:'Full digital platforms combining mobile app and web dashboard.',        features:['iOS & Android','Web Dashboard','Push Notifications','API Integration'],      tier:'enterprise'         },
];

const process_steps = [
  { num:'01', icon:'fa-solid fa-comments',      title:'Discovery Call',       desc:'We discuss your goals, audience and vision in a free consultation session.' },
  { num:'02', icon:'fa-solid fa-pen-ruler',     title:'Design & Prototype',   desc:'We craft wireframes and a visual prototype for your approval before coding.' },
  { num:'03', icon:'fa-solid fa-code',          title:'Development',          desc:'We build your project with clean, fast, secure and scalable code.' },
  { num:'04', icon:'fa-solid fa-rocket-launch', title:'Launch & Support',     desc:'We deploy, test, train your team and provide ongoing maintenance.' },
];

const whyUs = [
  { icon:'fa-solid fa-bolt',        title:'Fast Delivery',     desc:'Most projects delivered in 2–6 weeks with daily progress updates.' },
  { icon:'fa-solid fa-shield-halved',title:'Secure & Reliable', desc:'Every project includes SSL, security hardening and backups.' },
  { icon:'fa-solid fa-headset',     title:'24/7 Support',      desc:'Dedicated support channel after launch — we don\'t disappear.' },
  { icon:'fa-solid fa-chart-line',  title:'Growth Focused',    desc:'We build for performance, SEO and conversions — not just looks.' },
  { icon:'fa-solid fa-palette',     title:'Custom Design',     desc:'No templates. Every project is designed uniquely for your brand.' },
  { icon:'fa-solid fa-handshake',   title:'Transparent Pricing',desc:'Clear fixed quotes. No hidden fees or surprise invoices.' },
];

const tickerItems = ['Web Design','E-Commerce','Mobile Apps','UI/UX Design','SEO Optimization','Brand Identity','Corporate Websites','LMS Platforms'];

const stats = [
  { number:'120+', label:'Projects Delivered', icon:'fa-solid fa-layer-group'    },
  { number:'5+',   label:'Years Experience',   icon:'fa-solid fa-calendar-check' },
  { number:'98%',  label:'Client Satisfaction',icon:'fa-regular fa-face-smile'   },
  { number:'50+',  label:'Happy Clients',      icon:'fa-solid fa-users'          },
];

const testimonials = [
  { text:'They delivered our corporate website on time and it looks premium. Our sales increased 3x after launch!',       name:'Nahom Eshetu',     title:'CEO, Asella Organic',      initials:'NE' },
  { text:'Best e-commerce platform we ever had. Clean design, blazing fast performance, and outstanding support.',        name:'Selamawit Tesfaye',title:'Founder, Selam Fashion',       initials:'ST' },
  { text:'Our hotel booking system was built perfectly — intuitive, beautiful, and exactly what our guests needed.',      name:'Dawit Mekonnen',   title:'General Manager, Addis Hotel', initials:'DM' },
];

const tierLabels: Record<string,string> = { starter:'Starter', popular:'Most Popular', pro:'Professional', enterprise:'Enterprise' };
const tierColors: Record<string,string> = { starter:'#60a5fa', popular:'#d4a853',      pro:'#c084fc',      enterprise:'#34d399'   };

/* ─── COUNTER ────────────────────────────────────────────────── */
function useCounter(target: string, trigger: boolean) {
  const [display, setDisplay] = useState('0');
  useEffect(() => {
    if (!trigger) return;
    const num = parseInt(target.replace(/\D/g,''));
    if (!num) { setDisplay(target); return; }
    const suffix = target.replace(/[\d,]/g,'');
    let cur = 0; const inc = Math.ceil(num/60);
    const t = setInterval(() => { cur = Math.min(cur+inc,num); setDisplay(cur.toLocaleString()+suffix); if(cur>=num) clearInterval(t); }, 20);
    return () => clearInterval(t);
  }, [trigger, target]);
  return display;
}

function StatItem({ number, label, icon }: { number:string; label:string; icon:string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);
  const count = useCounter(number, triggered);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if(e.isIntersecting) setTriggered(true); }, { threshold:.4 });
    if(ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div className="stat-item" ref={ref}>
      <div className="stat-icon"><i className={icon} /></div>
      <div className="stat-number">{count}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/* ─── APP ────────────────────────────────────────────────────── */
export default function App() {
  const [dark, setDark]           = useState(() => localStorage.getItem('ed-theme') !== 'light');
  const [menuOpen, setMenuOpen]   = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [showTop, setShowTop]     = useState(false);
  const [formData, setFormData]     = useState({ name:'', email:'', phone:'', message:'' });
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [toast, setToast]           = useState<{ type:'success'|'error'; msg:string }|null>(null);

  const showToast = (type:'success'|'error', msg:string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 5500);
  };

  const validate = () => {
    const errs: Record<string,string> = {};
    if (!formData.name.trim())    errs.name    = 'Please enter your name.';
    if (!formData.email.trim())   errs.email   = 'Please enter your email.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = 'Enter a valid email address.';
    if (!formData.message.trim()) errs.message = 'Please describe your project.';
    return errs;
  };

  /* Lenis */
  useEffect(() => {
    const lenis = new Lenis({ duration:1.2, easing:(t:number)=>Math.min(1,1.001-Math.pow(2,-10*t)) });
    const raf = (time:number) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  /* Theme */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('ed-theme', dark ? 'dark' : 'light');
  }, [dark]);

  /* FontAwesome */
  useEffect(() => {
    if(document.getElementById('fa-cdn')) return;
    const l = document.createElement('link');
    l.id='fa-cdn'; l.rel='stylesheet';
    l.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(l);
  }, []);

  /* Scroll progress + back-to-top */
  useEffect(() => {
    const onScroll = () => {
      const el  = document.documentElement;
      const pct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
      setScrollPct(pct);
      setShowTop(el.scrollTop > 500);
    };
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const h = () => { if(window.innerWidth>768) setMenuOpen(false); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const scrollTo = (id:string) => { document.getElementById(id)?.scrollIntoView({ behavior:'smooth' }); setMenuOpen(false); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // clear inline error as user types
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // ── client-side validation first ──────────────────────────
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showToast('error', 'Please fill in all required fields.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res  = await fetch('http://localhost:5000/api/contact', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        showToast('success', '✓ Message sent! We\'ll reply within 24 hours.');
        setFormData({ name:'', email:'', phone:'', message:'' });
        setFieldErrors({});
      } else {
        showToast('error', data.message || 'Send failed. Please try again.');
      }
    } catch {
      showToast('error', 'Server offline — reach us on Telegram @yona64 or WhatsApp.');
    } finally {
      setSubmitting(false);
    }
  };

  const filters  = ['all','starter','pro','enterprise'];
  const filtered = activeFilter==='all' ? services : services.filter(s => s.tier===activeFilter || (activeFilter==='pro' && s.featured));

  return (
    <>
      {/* ── SCROLL PROGRESS ──────────────────────────────────── */}
      <div className="scroll-progress" style={{ width:`${scrollPct}%` }} />

      {/* ── NAV ──────────────────────────────────────────────── */}
      <nav>
        <div className="logo" onClick={() => scrollTo('hero')} style={{ cursor:'pointer' }}>Ethio<span>Digital</span></div>

        <div className={`nav-links ${menuOpen?'open':''}`}>
          {[['hero','Home'],['services-section','Services'],['process-section','Process'],['about-section','About'],['reviews-section','Reviews'],['contact-section','Contact']].map(([id,label]) => (
            <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          <button className="nav-cta" onClick={() => scrollTo('contact-section')}>
            <i className="fa-solid fa-paper-plane" /> Get a Quote
          </button>
        </div>

        <div className="nav-right">
          <button className="theme-toggle" onClick={() => setDark(d=>!d)} aria-label="Toggle theme">
            <i className={dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} />
          </button>
          <button className="hamburger" onClick={() => setMenuOpen(o=>!o)} aria-label="Menu">
            <i className={menuOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'} />
          </button>
        </div>
      </nav>
      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}

      {/* ── HERO — 2-column, no social pills ─────────────────── */}
      <section id="hero">
        <div className="hero-grid-bg" aria-hidden />
        <div className="hero-orb hero-orb-1" aria-hidden />
        <div className="hero-orb hero-orb-2" aria-hidden />
        <div className="hero-orb hero-orb-3" aria-hidden />

        {/* LEFT */}
        <div className="hero-left">
          <div className="hero-eyebrow fade-up">
            <span className="eyebrow-dot" /> Ethiopia's Premium Digital Agency
          </div>
          <h1 className="fade-up-2">
            We Build Digital<br /><em>Experiences</em><br />That Drive Growth
          </h1>
          <p className="hero-sub fade-up-3">
            From landing pages to full mobile + web platforms — we craft high-performance
            digital solutions that help Ethiopian businesses thrive locally and globally.
          </p>
          <div className="hero-actions fade-up-4">
            <button className="btn-primary btn-glow" onClick={() => scrollTo('contact-section')}>
              <i className="fa-solid fa-paper-plane" /> Get Free Quote
            </button>
            <button className="btn-ghost btn-glow-ghost" onClick={() => scrollTo('services-section')}>
              <i className="fa-solid fa-eye" /> View Services
            </button>
          </div>

          {/* trust row */}
          <div className="hero-trust fade-up-4">
            <div className="trust-item"><i className="fa-solid fa-shield-halved" /> Secure & Reliable</div>
            <div className="trust-sep" />
            <div className="trust-item"><i className="fa-solid fa-bolt" /> Fast Delivery</div>
            <div className="trust-sep" />
            <div className="trust-item"><i className="fa-solid fa-headset" /> 24/7 Support</div>
          </div>
        </div>

        {/* RIGHT — visual showcase */}
        <div className="hero-right fade-up-3">
          <div className="hero-visual">
            {/* central number */}
            <div className="hv-center">
              <div className="hv-big">120<span>+</span></div>
              <div className="hv-sub">Projects<br />Delivered</div>
            </div>

            {/* orbiting badge cards */}
            <div className="hv-badge hv-badge-1">
              <i className="fa-solid fa-building" style={{ color:'#d4a853' }} />
              <span>Corporate Sites</span>
            </div>
            <div className="hv-badge hv-badge-2">
              <i className="fa-solid fa-cart-shopping" style={{ color:'#c084fc' }} />
              <span>E-Commerce</span>
            </div>
            <div className="hv-badge hv-badge-3">
              <i className="fa-solid fa-mobile-screen" style={{ color:'#34d399' }} />
              <span>Mobile Apps</span>
            </div>
            <div className="hv-badge hv-badge-4">
              <i className="fa-solid fa-graduation-cap" style={{ color:'#60a5fa' }} />
              <span>E-Learning</span>
            </div>

            {/* floating stat pills */}
            <div className="hv-pill hv-pill-1"><i className="fa-solid fa-star" /> 98% Satisfaction</div>
            <div className="hv-pill hv-pill-2"><i className="fa-solid fa-clock" /> 2–6 Week Delivery</div>

            {/* ring decoration */}
            <div className="hv-ring hv-ring-1" />
            <div className="hv-ring hv-ring-2" />
          </div>
        </div>

        <div className="scroll-hint fade-up-4">
          <i className="fa-solid fa-chevron-down" />
        </div>
      </section>

      {/* ── TICKER ───────────────────────────────────────────── */}
      <div className="ticker-wrap">
        <div className="ticker-track">
          {[...tickerItems,...tickerItems].map((item,i) => (
            <span key={i} className="ticker-item"><i className="fa-solid fa-diamond ticker-diamond" /> {item}</span>
          ))}
        </div>
      </div>

      {/* ── STATS ────────────────────────────────────────────── */}
      <div id="stats">
        {stats.map(s => <StatItem key={s.label} number={s.number} label={s.label} icon={s.icon} />)}
      </div>

      {/* ── SERVICES ─────────────────────────────────────────── */}
      <div id="services-section" className="section-wrap">
        <div className="section-eyebrow"><i className="fa-solid fa-code" /> What We Build</div>
        <div className="section-header-row">
          <div className="section-title">Services &amp; <em>Pricing</em></div>
          <div className="filter-tabs">
            {filters.map(f => (
              <button key={f} className={`filter-tab ${activeFilter===f?'active':''}`} onClick={() => setActiveFilter(f)}>
                {f==='all' ? 'All' : tierLabels[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="pricing-grid">
          {filtered.map(s => (
            <div key={s.id} className={`plan-card ${s.featured?'featured':''}`} style={{ '--tier-color':tierColors[s.tier] } as React.CSSProperties}>
              <div className="plan-card-top">
                <div className="plan-icon-wrap" style={{ background:`${tierColors[s.tier]}18`, border:`1px solid ${tierColors[s.tier]}35` }}>
                  <i className={s.icon} style={{ color:tierColors[s.tier] }} />
                </div>
                <div className="plan-tier-badge" style={{ color:tierColors[s.tier], background:`${tierColors[s.tier]}14`, border:`1px solid ${tierColors[s.tier]}30` }}>
                  {s.featured && <i className="fa-solid fa-crown" />} {tierLabels[s.tier]}
                </div>
              </div>
              <div className="plan-type">{s.type}</div>
              <div className="plan-best">{s.best}</div>
              <div className="plan-features">
                {s.features.map(f => (
                  <div key={f} className="plan-feature">
                    <i className="fa-solid fa-check" style={{ color:tierColors[s.tier] }} /> {f}
                  </div>
                ))}
              </div>
              <div className="plan-footer">
                <div>
                  <div className="price-range">{s.price} <span>ETB</span></div>
                  <div className="price-note">One-time project price</div>
                </div>
                <button className="btn-plan-glow" onClick={() => scrollTo('contact-section')}
                  style={{ '--btn-color':tierColors[s.tier] } as React.CSSProperties}>
                  Quote <i className="fa-solid fa-arrow-right" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="services-footer">
          <span className="services-footer-text"><i className="fa-solid fa-circle-info" /> All projects include:</span>
          <div className="services-footer-tags">
            {['Responsive Design','SEO','Admin Dashboard','Security','Training & Support'].map(t => (
              <span key={t} className="tag"><i className="fa-solid fa-check" /> {t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── HOW WE WORK ──────────────────────────────────────── */}
      <div id="process-section" className="process-wrap">
        <div className="process-inner">
          <div className="section-eyebrow"><i className="fa-solid fa-diagram-project" /> How We Work</div>
          <div className="section-title">Our <em>Process</em></div>
          <div className="process-grid">
            {process_steps.map((step, idx) => (
              <div key={step.num} className="process-card">
                <div className="process-num">{step.num}</div>
                <div className="process-icon"><i className={step.icon} /></div>
                <div className="process-title">{step.title}</div>
                <div className="process-desc">{step.desc}</div>
                {idx < process_steps.length-1 && <div className="process-connector" aria-hidden />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── WHY US ───────────────────────────────────────────── */}
      <div id="whyus-section" className="section-wrap">
        <div className="section-eyebrow"><i className="fa-solid fa-trophy" /> Why Choose Us</div>
        <div className="section-title">Built Different, <em>Delivered Better</em></div>
        <div className="whyus-grid">
          {whyUs.map(w => (
            <div key={w.title} className="whyus-card">
              <div className="whyus-icon"><i className={w.icon} /></div>
              <div className="whyus-title">{w.title}</div>
              <div className="whyus-desc">{w.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ABOUT ────────────────────────────────────────────── */}
      <div id="about-section">
        <div className="about-inner">
          <div className="section-eyebrow"><i className="fa-solid fa-users" /> Who We Are</div>
          <p className="about-quote">
            We are a passionate digital agency based in Ethiopia, turning visions into powerful
            online experiences that connect businesses with the world.
          </p>
          <div className="about-meta">
            With years of expertise, we build high-performance websites and apps that help
            businesses grow locally and globally.
          </div>
          <div className="about-divider" />
        </div>
      </div>

      {/* ── REVIEWS ──────────────────────────────────────────── */}
      <div id="reviews-section" className="section-wrap">
        <div className="section-eyebrow"><i className="fa-solid fa-star" /> Testimonials</div>
        <div className="section-title">What Our <em>Clients</em> Say</div>
        <div className="testimonials-grid">
          {testimonials.map(t => (
            <div key={t.name} className="testimonial-card">
              <div className="stars">{[...Array(5)].map((_,i) => <i key={i} className="fa-solid fa-star" />)}</div>
              <p className="testimonial-text">"{t.text}"</p>
              <div className="testimonial-author">
                <div className="author-avatar">{t.initials}</div>
                <div>
                  <div className="author-name">{t.name}</div>
                  <div className="author-title">{t.title}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CONTACT ──────────────────────────────────────────── */}
      <div id="contact-section">
        <div className="contact-inner">
          <div className="contact-info">
            <div className="section-eyebrow"><i className="fa-solid fa-paper-plane" /> Get In Touch</div>
            <div className="section-title">Let's Build<br /><em>Together</em></div>
            <p>Tell us about your project and we'll respond within 24 hours with a detailed proposal.</p>

            {[
              { href:'https://wa.me/251910011818',       cls:'whatsapp-icon', icon:'fa-brands fa-whatsapp', label:'WhatsApp', val:'+251-910011818',           ext:true  },
              { href:'https://t.me/yona64',              cls:'telegram-icon', icon:'fa-brands fa-telegram', label:'Telegram', val:'@yona64',                  ext:true  },
              { href:'mailto:yonasmindaye04@gmail.com',  cls:'email-icon',    icon:'fa-solid fa-envelope',  label:'Email',    val:'yonasmindaye04@gmail.com', ext:false },
            ].map(c => (
              <a key={c.label} href={c.href} target={c.ext?'_blank':undefined} rel="noopener noreferrer" className="contact-detail">
                <div className={`contact-detail-icon ${c.cls}`}><i className={c.icon} /></div>
                <div className="contact-detail-text"><strong>{c.label}</strong><span>{c.val}</span></div>
                <i className="fa-solid fa-arrow-up-right-from-square contact-detail-arrow" />
              </a>
            ))}
            <div className="contact-detail no-link">
              <div className="contact-detail-icon location-icon"><i className="fa-solid fa-location-dot" /></div>
              <div className="contact-detail-text"><strong>Location</strong><span>Addis Ababa, Ethiopia</span></div>
            </div>
          </div>

          <div className="contact-form-wrap">
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-row">
                <div className={`form-group ${fieldErrors.name ? 'has-error' : ''}`}>
                  <label htmlFor="name"><i className="fa-solid fa-user" /> Full Name <span className="req">*</span></label>
                  <input id="name" type="text" name="name" placeholder="Nahom Eshetu" value={formData.name} onChange={handleChange} className={fieldErrors.name ? 'input-error' : ''} />
                  {fieldErrors.name && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.name}</span>}
                </div>
                <div className={`form-group ${fieldErrors.email ? 'has-error' : ''}`}>
                  <label htmlFor="email"><i className="fa-solid fa-envelope" /> Email <span className="req">*</span></label>
                  <input id="email" type="email" name="email" placeholder="you@example.com" value={formData.email} onChange={handleChange} className={fieldErrors.email ? 'input-error' : ''} />
                  {fieldErrors.email && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.email}</span>}
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="phone"><i className="fa-solid fa-phone" /> Phone Number <span style={{ color:'var(--text-dim)', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'.75rem' }}>(optional)</span></label>
                <input id="phone" type="tel" name="phone" placeholder="+251 910 011 818" value={formData.phone} onChange={handleChange} />
              </div>
              <div className={`form-group ${fieldErrors.message ? 'has-error' : ''}`}>
                <label htmlFor="message"><i className="fa-solid fa-message" /> Your Project <span className="req">*</span></label>
                <textarea id="message" name="message" rows={5} placeholder="Tell us about your project, goals, and timeline..." value={formData.message} onChange={handleChange} className={fieldErrors.message ? 'input-error' : ''} />
                {fieldErrors.message && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.message}</span>}
              </div>
              <button type="submit" className="btn-primary btn-glow btn-full" disabled={submitting} style={{ opacity:submitting?0.7:1 }}>
                {submitting ? <><i className="fa-solid fa-spinner fa-spin" /> Sending…</> : <><i className="fa-solid fa-paper-plane" /> Send Message</>}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer>
        <div className="footer-logo">Ethio<span>Digital</span></div>
        <div className="footer-copy"><i className="fa-solid fa-heart" style={{ color:'var(--accent)' }} /> © 2026 EthioDigital · Built with care in Ethiopia</div>
        <div className="footer-links">
          {[['#hero','fa-solid fa-house'],['https://t.me/yona64','fa-brands fa-telegram'],['mailto:yonasmindaye04@gmail.com','fa-solid fa-envelope'],['https://wa.me/251910011818','fa-brands fa-whatsapp']].map(([href,icon]) => (
            <a key={icon} href={href} target={href.startsWith('http')?'_blank':undefined} rel="noopener noreferrer"><i className={icon} /></a>
          ))}
        </div>
      </footer>

      {/* ── BACK TO TOP ──────────────────────────────────────── */}
      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top:0, behavior:'smooth' })} aria-label="Back to top">
          <i className="fa-solid fa-chevron-up" />
        </button>
      )}

      {/* ── TOAST ────────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <i className={toast.type==='success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'} />
          <span>{toast.msg}</span>
          <button className="toast-close" onClick={() => setToast(null)}><i className="fa-solid fa-xmark" /></button>
        </div>
      )}
    </>
  );
}