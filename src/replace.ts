import fs from 'fs'
import { doUnspeakableThings } from './unspeakableThings'

const thing = fs.readFileSync('test.tex.txt', 'utf8')

fs.writeFileSync('test2.tex.txt', doUnspeakableThings(thing))
