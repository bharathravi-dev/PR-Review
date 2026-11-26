// Review page v2 (Epic 9). Same ReviewService v1 as classic.
import { followPreference, switchTo } from '/ui-switch.js'

followPreference('v2')

const app = document.getElementById('app')
const p = document.createElement('p')
p.textContent = 'The new review page is being built. '
const back = document.createElement('a')
back.href = '/classic/'
back.textContent = 'Switch to classic'
back.addEventListener('click', (ev) => {
  ev.preventDefault()
  switchTo('classic')
})
p.append(back)
app.append(p)
