"use strict";
const counter = document.getElementById('counter');
const increment = document.getElementById('increment');
const decrement = document.getElementById('decrement');
const reset = document.getElementById('reset');
let count = 0;
function updateCounter() {
    counter.textContent = count.toString(); // set the counter element = to the count variable.
}
increment.addEventListener('click', () => {
    count++;
    updateCounter();
});
decrement.addEventListener('click', () => {
    count--;
    updateCounter();
});
reset.addEventListener('click', () => {
    count = 0;
    updateCounter();
});
