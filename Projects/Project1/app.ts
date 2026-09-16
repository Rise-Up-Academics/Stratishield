const counter = document.getElementById('counter') as HTMLDivElement;
const increment = document.getElementById('increment') as HTMLButtonElement;
const decrement = document.getElementById('decrement') as HTMLButtonElement;
const reset = document.getElementById('reset') as HTMLButtonElement;

let count = 0;

function updateCounter()
{
    counter.textContent = count.toString(); // set the counter element = to the count variable.
}

increment.addEventListener('click', () => 
{
    count++;
    updateCounter();
});

decrement.addEventListener('click', () =>
{
    count--;
    updateCounter();
});

reset.addEventListener('click', () =>
{
    count = 0;
    updateCounter();
}); 