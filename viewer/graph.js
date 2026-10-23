// Pure graph helpers: IDs remain strings to preserve FlyWire's 64-bit identifiers.
export function matchesNeuron(neuron, {classIndex='all',side='all'}={}) {
  return (classIndex==='all'||neuron[4]===Number(classIndex)) && (side==='all'||neuron[7]===side);
}
export function selectEdges(values, neurons, {minimum=1,limit=20000,source=-1,...filters}={}) {
  const result=[];
  for(let i=0;i<values.length && result.length<limit*3;i+=3){
    const [from,to,weight]=values.subarray(i,i+3);
    if(source>=0&&from!==source)continue;
    if(weight<minimum||!matchesNeuron(neurons[from],filters)||!matchesNeuron(neurons[to],filters))continue;
    result.push(from,to,weight);
  }
  return result;
}
