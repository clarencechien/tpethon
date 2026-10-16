function revealHash(){
 const id=decodeURIComponent(location.hash.slice(1));if(!id)return;
 const target=document.getElementById(id);if(!target)return;
 for(let node=target;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
 target.scrollIntoView({block:'start'});
}
window.addEventListener('hashchange',revealHash);if(location.hash)requestAnimationFrame(revealHash);
