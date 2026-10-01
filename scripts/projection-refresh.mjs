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
  return affects(changedPaths(changes),type==='Actor'?['ownership']:['type','name','ownership','flags','system.amount','system.equipped','system.installedItems']);
}
export function requiresUserAccessRefresh(userId,changes,currentUserId) {
  const paths=changedPaths(changes);
  return affects(paths,['role']) || (userId===currentUserId && affects(paths,['viewedScene','character']));
}

/** Session cache. Authoritative refreshes queue behind older requests. */
export class ProjectionRefresh {
  constructor({context,fetch,accept}) {
    this.context=context;this.fetch=fetch;this.accept=accept;
    this.epoch=0;this.sequence=0;this.accepted=0;
    this.fresh=null;this.inflight=null;this.trailing=null;
  }
  invalidate() {
    this.epoch++;this.fresh=null;
    if(this.inflight && this.inflight.context!==this.context()){this.trailing=null;this.inflight.release();}
  }
  isFresh(context) { return this.fresh?.context===context && this.fresh.epoch===this.epoch; }
  start() {
    this.inflight?.release();
    const request={context:this.context(),epoch:this.epoch,sequence:++this.sequence};
    const retired=Symbol('obsolete projection');
    const retirement=new Promise(resolve=>{request.release=()=>resolve(retired);});
    this.inflight=request;
    // Release waiting renders on a changed context; the transport still owns its timeout.
    request.promise=Promise.race([Promise.resolve().then(()=>this.fetch()),retirement]).then(state=>{
      if(state===retired)return;
      if(request.context!==this.context() || request.epoch!==this.epoch || request.sequence<=this.accepted)return;
      if(!state || typeof state!=='object')throw Error('Не удалось получить данные Агента');
      this.accept(state);this.accepted=request.sequence;
      this.fresh={context:request.context,epoch:request.epoch};
    }).catch(error=>{
      if(request.context===this.context() && request.epoch===this.epoch)throw error;
    }).finally(()=>{if(this.inflight===request)this.inflight=null;});
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
  async refresh({cached=false}={}) {
    if(!cached)this.invalidate();
    while(true) {
      const context=this.context();
      if(context===null){this.trailing=null;this.inflight?.release();return;}
      if(this.isFresh(context))return;
      if(this.inflight && this.inflight.context!==context){this.trailing=null;await this.start();}
      else if(this.trailing)await this.trailing.promise;
      else if(!this.inflight)await this.start();
      else if(this.inflight.context===context && this.inflight.epoch===this.epoch)await this.inflight.promise;
      else await this.queue();
    }
  }
}
