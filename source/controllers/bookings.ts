import {Request, Response, NextFunction} from 'express';
import prisma from '../prisma'

interface Booking {
    guestName: string;
    unitID: string;
    checkInDate: Date;
    numberOfNights: number;
}

interface ExtendedBooking {
    guestName: string;
    unitID: string;
    numberOfNights: number;
}

const healthCheck = async (req: Request, res: Response, next: NextFunction) => {
    return res.status(200).json({
        message: "OK"
    })
}

const createBooking = async (req: Request, res: Response, next: NextFunction) => {
    const booking: Booking = req.body;

    let outcome = await isBookingPossible(booking);
    if (!outcome.result) {
        return res.status(400).json(outcome.reason);
    }

    let bookingResult = await prisma.booking.create({
        data: {
            guestName: booking.guestName,
            unitID: booking.unitID,
            checkInDate: new Date(booking.checkInDate),
            numberOfNights: booking.numberOfNights
        }
    })

    return res.status(200).json(bookingResult);
}

type bookingOutcome = {result:boolean, reason:string};

async function isBookingPossible(booking: Booking): Promise<bookingOutcome> {
    // check 1 : The Same guest cannot book the same unit multiple times
    let sameGuestSameUnit = await prisma.booking.findMany({
        where: {
            AND: {
                guestName: {
                    equals: booking.guestName,
                },
                unitID: {
                    equals: booking.unitID,
                },
            },
        },
    });
    if (sameGuestSameUnit.length > 0) {
        return {result: false, reason: "The given guest name cannot book the same unit multiple times"};
    }

    // check 2 : the same guest cannot be in multiple units at the same time
    let sameGuestAlreadyBooked = await prisma.booking.findMany({
        where: {
            guestName: {
                equals: booking.guestName,
            },
        },
    });
    if (sameGuestAlreadyBooked.length > 0) {
        return {result: false, reason: "The same guest cannot be in multiple units at the same time"};
    }

    // check 3 : Unit is available for the check-in date
    let getAllBookingsForUnit: Booking[] = await getAllBookingsOnUnit(booking.unitID);

    if (getAllBookingsForUnit.length > 0) {
        const isAvailable = await isDateRangeAvailable(new Date(booking.checkInDate), booking.numberOfNights, booking.unitID);
        if (!isAvailable) {
            return {result: false, reason: "For the given check-in date, the unit is already occupied"};
        }
    }
    return {result: true, reason: "OK"};
}

const extendBooking = async (req: Request, res: Response, next: NextFunction) => {
    const extend: ExtendedBooking = req.body;
    // check if user has active booking for the unit
    const hasActiveBooking = await prisma.booking.findFirst({
        where: {
            AND: {
                guestName: {
                    equals: extend.guestName,
                },
                unitID: {
                    equals: extend.unitID,
                }
            }
        }
    });

    if (!hasActiveBooking) {
        return res.status(400).json("No active bookings found for this guest");
    }
    // get extended checkInDate
    const extendedCheckInDate = getCheckoutDate(hasActiveBooking.checkInDate, hasActiveBooking.numberOfNights)

    const isExtendAvailable = await isDateRangeAvailable(
        extendedCheckInDate,
        extend.numberOfNights,
        extend.unitID);
    if (!isExtendAvailable) {
        return res.status(400).json("extend booking is not possible, this unit is already reserved by other customer");
    }

    // save extended booking
    const updatedBooking = await prisma.booking.update({
        where: {
            id: hasActiveBooking.id
        },
        data: {
            numberOfNights: hasActiveBooking.numberOfNights + extend.numberOfNights
        }
    });

    return res.status(200).json(updatedBooking);
}


async function isDateRangeAvailable(checkInDate: Date, numberOfNights: number, unitID: string) {
    const newCheckOutDate = getCheckoutDate(checkInDate, numberOfNights);

    for (const booking of await getAllBookingsOnUnit(unitID)) {
        const existingCheckInDate = booking.checkInDate;
        const existingCheckOutDate = getCheckoutDate(existingCheckInDate, booking.numberOfNights)

        if (
            (checkInDate >= existingCheckInDate && checkInDate < existingCheckOutDate) ||
            (newCheckOutDate > existingCheckInDate && newCheckOutDate <= existingCheckOutDate) ||
            (checkInDate <= existingCheckInDate && newCheckOutDate >= existingCheckOutDate)
        ) {
            return false;
        }
    }

    return true;
}


function getAllBookingsOnUnit(unitID: string): Promise<Booking[]> {
    return prisma.booking.findMany({
        where: {
            unitID: {
                equals: unitID,
            }
        }
    });
}

function getCheckoutDate(checkInDate: Date, numberOfNights: number) {
    const checkOutDate = new Date(checkInDate);
    checkOutDate.setDate(checkOutDate.getDate() + numberOfNights);
    return checkOutDate;
}

export default {healthCheck, createBooking, extendBooking}
