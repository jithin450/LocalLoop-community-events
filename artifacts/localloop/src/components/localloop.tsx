import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Bookmark, CalendarDays, MapPin, Users, Search, Sun, Moon, Bell, Plus, ArrowRight, Compass, Menu, X } from 'lucide-react';
import { useToggleSavedEvent, useNotifications, useMarkNotificationRead } from '@/lib/queries';
import { useAuth } from '@/lib/auth';

export type EventRecord = {
  id: string; organizer_id?: string; title: string; description?: string; cover_image_url?: string | null;
  location_name?: string; address?: string; city?: string; start_time?: string; end_time?: string;
  capacity?: number | null; attendee_count?: number; is_online?: boolean; online_url?: string;
  status?: string; categories?: Array<{name:string}|string>; organizer?: {full_name?:string;username?:string};isGoing?:boolean;isSaved?:boolean;
};

export function useThemeMode() {
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && localStorage.getItem('localloop-theme') === 'dark');
  const toggle = () => setDark(value => { const next=!value; document.documentElement.classList.toggle('dark',next); localStorage.setItem('localloop-theme',next?'dark':'light'); return next; });
  return {dark,toggle};
}

export function Shell({children}:{children:ReactNode}) {
  const [location,setLocation] = useLocation();
  const {dark,toggle}=useThemeMode();
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark)},[dark]);
  const auth:any=useAuth();
  const notifications:any=useNotifications();
  const mark:any=useMarkNotificationRead();
  const [noticeOpen,setNoticeOpen]=useState(false),[mobileOpen,setMobileOpen]=useState(false);
  const links=[['Home','/'],['Explore','/explore'],['Create event','/events/new'],['My events','/my-events'],['Saved','/saved']];
  const profile=auth.profile;
  const notices=notifications.data?.notifications||notifications.data||[];
  const count=Array.isArray(notices)?notices.filter((n:any)=>!(n.read??Boolean(n.read_at))).length:0;
  const backendReady=Boolean(import.meta.env.VITE_SUPABASE_URL&&import.meta.env.VITE_SUPABASE_ANON_KEY);
  const navLinks=links.map(([name,path])=><Link data-testid={`link-nav-${name.toLowerCase().replaceAll(' ','-')}`} key={path} href={path} onClick={()=>setMobileOpen(false)} className={`nav-link ${location===path?'nav-active':''}`}>{name==='Create event'&&<Plus size={15}/>}<span>{name}</span></Link>);
  return <div className="min-h-[100dvh] bg-background">
    <header className="site-header"><div className="shell-width header-inner">
      <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><span/></span><span>Local<span>Loop</span></span></Link>
      <nav className="desktop-nav">{navLinks}</nav>
      <div className="header-actions">
        <button className="icon-button" aria-label="Toggle color theme" data-testid="button-theme" onClick={toggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
        {auth.user&&<button className="icon-button notice-trigger" aria-label="Notifications" data-testid="button-notifications" onClick={()=>setNoticeOpen(!noticeOpen)}><Bell size={18}/>{count>0&&<i/>}</button>}
        {auth.user?<Link href="/profile" className="profile-chip" data-testid="link-profile"><span className="avatar-small">{(profile?.full_name||auth.user.email||'L').slice(0,1).toUpperCase()}</span><span>{profile?.full_name?.split(' ')[0]||'Profile'}</span></Link>:<Link href="/login" className="sign-in-link" data-testid="link-login">Log in</Link>}
        <button className="mobile-menu-button icon-button" data-testid="button-mobile-menu" onClick={()=>setMobileOpen(!mobileOpen)} aria-label="Open menu">{mobileOpen?<X size={19}/>:<Menu size={19}/>}</button>
      </div>
      {noticeOpen&&<div className="notification-popover"><div className="popover-head">Notifications <span>{count} new</span></div>{notifications.isLoading?<p className="muted-copy">Loading notifications…</p>:notifications.error?<p className="muted-copy">Notifications are unavailable right now.</p>:notices.length?notices.map((n:any)=><button key={n.id} className={`notice-row ${(n.read??Boolean(n.read_at))?'':'unread'}`} onClick={()=>mark.mutate?.(n.id,{onSuccess:()=>{if(n.event_id){setNoticeOpen(false);setLocation(`/events/${n.event_id}`)}}})}><b>{n.title}</b><span>{n.message}</span></button>):<p className="muted-copy">You’re all caught up.</p>}</div>}
    </div>{mobileOpen&&<nav className="mobile-nav shell-width">{navLinks}{auth.user&&<Link href="/dashboard" className="nav-link" onClick={()=>setMobileOpen(false)}>Organizer dashboard</Link>}</nav>}</header>
    {!backendReady&&<div className="config-banner shell-width" role="status"><span>LocalLoop isn’t connected to its community database yet.</span><span>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable events and sign-in.</span></div>}
    <main>{children}</main>
    <footer className="site-footer"><div className="shell-width footer-inner"><Link href="/" className="brand"><span className="brand-mark"><span/></span><span>Local<span>Loop</span></span></Link><span>Good things happen close to home.</span><Link href="/explore" className="footer-link">Find your next thing <ArrowRight size={14}/></Link></div></footer>
    <nav className="mobile-bottom"><Link href="/" className={location==='/'?'bottom-active':''}><Compass/><span>Home</span></Link><Link href="/explore" className={location==='/explore'?'bottom-active':''}><Search/><span>Explore</span></Link><Link href="/events/new" className="bottom-create"><Plus/><span>Create</span></Link><Link href="/my-events"><CalendarDays/><span>My events</span></Link><Link href="/profile"><Users/><span>Profile</span></Link></nav>
  </div>;
}

export function EventCard({event}:{event:EventRecord}) {
  const save:any=useToggleSavedEvent();
  const auth:any=useAuth();
  const [,setLocation]=useLocation();
  const saved=Boolean((event as any).isSaved||(event as any).is_saved||(event as any).saved);
  const categories=Array.isArray(event.categories)?event.categories:[]; // supplied query data only
  const category=categories.map((c:any)=>typeof c==='string'?c:c.name).filter(Boolean)[0];
  const date=event.start_time?new Date(event.start_time):null;
  const remaining=event.capacity?Math.max(0,event.capacity-(event.attendee_count||0)):null;
  return <article className="event-card surface" data-testid={`card-event-${event.id}`}>
    <Link href={`/events/${event.id}`} className="event-image-link" data-testid={`link-event-image-${event.id}`}>
      {event.cover_image_url?<img className="event-cover" src={event.cover_image_url} alt=""/>:<div className="event-cover cover-placeholder"><span className="cover-orbit orbit-one"/><span className="cover-orbit orbit-two"/><span className="cover-word">{(category||'LOCAL').slice(0,10)}</span></div>}
      {category&&<span className="category-pill">{category}</span>}
    </Link>
    <button className={`save-button ${saved?'is-saved':''}`} aria-label={saved?'Remove saved event':'Save event'} data-testid={`button-save-${event.id}`} disabled={save.isPending} onClick={()=>auth.user?save.mutate?.(event.id):setLocation('/login')}><Bookmark size={17} fill={saved?'currentColor':'none'}/></button>
    <div className="event-card-body">
      <div className="event-card-date">{date&&<><span>{date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><span className="date-dot"/> <span>{date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</span></>}</div>
      <Link href={`/events/${event.id}`} className="event-title-link"><h3>{event.title}</h3></Link>
      <p className="event-description">{event.description||'Join your neighbors for a local gathering.'}</p>
      <div className="event-card-meta"><span><MapPin size={14}/>{event.is_online?'Online':event.city||event.location_name||'Location to be announced'}</span><span><Users size={14}/>{event.attendee_count||0}{event.capacity?` / ${event.capacity}`:''}</span></div>
      {save.error&&<button className="card-action-error" onClick={()=>save.reset?.()}>Couldn’t update saved events. Dismiss</button>}
      {remaining===0&&<div className="full-label">At capacity</div>}
    </div>
  </article>;
}

export function EventGrid({events,loading,error,onRetry,emptyTitle='Nothing nearby yet',emptyText='Try changing your filters, or check back as more neighbors add events.'}:{events?:EventRecord[];loading?:boolean;error?:boolean;onRetry?:()=>void;emptyTitle?:string;emptyText?:string}) {
  if(loading)return <div className="event-grid">{[0,1,2].map(n=><div className="skeleton-card" key={n}><div/><section><i/><i/><i/></section></div>)}</div>;
  if(error)return <div className="state-panel"><span className="state-icon">!</span><h3>We couldn’t load events</h3><p>Check your connection and give it another try.</p><button className="button secondary-button" onClick={onRetry}>Try again</button></div>;
  if(!events?.length)return <div className="state-panel"><span className="state-icon"><CalendarDays size={24}/></span><h3>{emptyTitle}</h3><p>{emptyText}</p><Link href="/events/new" className="button primary-button">Host the first event <ArrowRight size={16}/></Link></div>;
  return <div className="event-grid">{events.map(event=><EventCard key={event.id} event={event}/>)}</div>;
}
