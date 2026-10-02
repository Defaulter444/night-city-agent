/** Only ownership and memory-chip changes can alter a document projection. */
function changedPaths(changes) {
  const paths=[];
  const visit=(value,prefix='')=>{
    for(const [key,child] of Object.entries(value??{})){
      const path=(prefix?prefix+'.':'')+key.replace(/(^|\.)(?:-=|==)/g,'$1');
      if(child && typeof child==='object' && !Array.isArray(child) && Object.keys(child).length)visit(child,path);
      else paths.push(path);
    }
  };
  visit(changes);
  return paths;
}
const affects=(paths,fields)=>paths.some(path=>fields.some(field=>path===field||path.startsWith(field+'.')||field.startsWith(path+'.')));
export function requiresAccessRefresh(type,changes) {
  return affects(changedPaths(changes),type==='Actor'?['ownership']:['type','name','ownership','flags.night-city-agent','flags.babele.originalName','system.amount','system.equipped','system.installedItems']);
}
export function requiresUserAccessRefresh(userId,changes,currentUserId) {
  const paths=changedPaths(changes);
  return affects(paths,['role']) || (userId===currentUserId && affects(paths,['viewedScene','character']));
}

/** Session cache. Authoritative refreshes queue behind older requests. */
export class ProjectionRefresh {
  constructor({context,fetch,accept,change=()=>{}}) {
    this.context=context;this.fetch=fetch;this.accept=accept;
    this.change=change;
    this.epoch=0;this.accessEpoch=0;this.sequence=0;this.accepted=0;
    this.fresh=null;this.inflight=null;this.trailing=null;
    this.usable=null;this.error=null;this.requiredRevision=0;
  }
  invalidate({access=true}={}) {
    this.epoch++;this.fresh=null;
    if(access)this.accessEpoch++;
    this.staleResponses=0;
    this.error=null;this.requiredRevision=0;
    if(this.inflight && this.inflight.context!==this.context()){this.trailing=null;this.inflight.release();}
  }
  requireRevision(revision) {
    const context=this.context();
    if(this.revisionContext!==context){this.requiredRevision=0;this.staleResponses=0;this.revisionContext=context;}
    if(!Number.isSafeInteger(revision) || revision<0)return;
    if(revision>this.requiredRevision){this.requiredRevision=revision;this.error=null;this.staleResponses=0;this.change();}
  }
  status() {
    const context=this.context();
    return {
      usable:context!==null && this.usable?.context===context && this.usable.accessEpoch===this.accessEpoch,
      fresh:context!==null && this.isFresh(context),
      loading:context!==null && this.inflight?.context===context,
      error:this.error?.context===context && this.error.epoch===this.epoch?this.error.message:null
    };
  }
  isFresh(context) { return this.fresh?.context===context && this.fresh.epoch===this.epoch && this.fresh.revision>=this.requiredRevision; }
  start() {
    this.inflight?.release();
    const context=this.context();
    // Revision counters belong to one GM/world session. A replacement GM may
    // legitimately serve an older restored world; access checks still apply.
    if(this.revisionContext!==context){this.requiredRevision=0;this.staleResponses=0;this.revisionContext=context;}
    const request={context,epoch:this.epoch,accessEpoch:this.accessEpoch,sequence:++this.sequence};
    this.error=null;
    const retired=Symbol('obsolete projection');
    const retirement=new Promise(resolve=>{request.release=()=>resolve(retired);});
    this.inflight=request;
    // Release waiting renders on a changed context; the transport still owns its timeout.
    request.promise=Promise.race([Promise.resolve().then(()=>this.fetch()),retirement]).then(state=>{
      if(state===retired)return;
      if(request.context!==this.context() || request.epoch!==this.epoch || request.sequence<=this.accepted)return;
      if(!state || typeof state!=='object')throw Error('Не удалось получить данные Агента');
      // A notice names the revision already committed by the GM. Do not
      // invalidate a matching in-flight request merely to fetch it twice.
      if((state.revision??0)<this.requiredRevision){
        if(++this.staleResponses>=2)throw Error('Мастер вернул устаревшие данные. Повторите подключение.');
        return;
      }
      this.staleResponses=0;
      this.accept(state);this.accepted=request.sequence;
      this.fresh={context:request.context,epoch:request.epoch,revision:state.revision??0};
      this.usable={...this.fresh,accessEpoch:request.accessEpoch};
    }).catch(error=>{
      if(request.context===this.context() && request.epoch===this.epoch){
        this.error={context:request.context,epoch:request.epoch,message:error.message};
        throw error;
      }
    }).finally(()=>{if(this.inflight===request){this.inflight=null;this.change();}});
    return request.promise;
  }
  queue() {
    if(!this.trailing) {
      const queued={};
      queued.promise=this.inflight.promise.catch(()=>{}).then(()=>{
        if(this.trailing!==queued)return;
        this.trailing=null;
        return this.context()===null?undefined:this.start();
      });
      this.trailing=queued;
    }
    return this.trailing.promise;
  }
  async refresh({cached=false,minRevision}={}) {
    if(!cached)this.invalidate();
    this.requireRevision(minRevision);
    while(true) {
      const context=this.context();
      if(context===null){this.trailing=null;this.inflight?.release();this.error=null;this.revisionContext=null;return;}
      if(this.isFresh(context))return;
      if(this.inflight && this.inflight.context!==context){this.trailing=null;await this.start();}
      else if(this.trailing)await this.trailing.promise;
      else if(!this.inflight)await this.start();
      else if(this.inflight.context===context && this.inflight.epoch===this.epoch)await this.inflight.promise;
      else await this.queue();
    }
  }
}
