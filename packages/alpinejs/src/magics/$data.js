import { scope } from '../scope'
import { magic } from '../magics'

// $data
magic('data', el => scope(el))
